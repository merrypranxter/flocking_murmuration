// update_sardine_boids.frag
// GPGPU update shader — Sardine Ball
// 200,000 agents, tight spherical school, pressure-wave coherence, shark evasion.
//
// Sardine schools pack far denser than starlings and respond to threats with a
// "bait ball" formation — the outer edge contracts inward while inner fish push
// outward, creating oscillating pressure waves. After a shark strike the ball
// splits, then reforms via long-range alignment.
//
// Biology: Parrish & Viscido 2005; Lukeman et al. 2010.

#extension GL_EXT_draw_buffers : require
precision highp float;

uniform sampler2D u_positionTex;
uniform sampler2D u_velocityTex;
uniform float     u_agentTexSize;

uniform sampler2D u_hashTex;
uniform sampler2D u_cellsTex;
uniform float     u_hashTexSize;

uniform vec3  u_predatorPos;       // shark position
uniform float u_predatorActive;

uniform float u_dt;
uniform float u_separationRadius; // 0.025 — very tight packing
uniform float u_alignRadius;      // 0.06
uniform float u_cohesionRadius;   // 0.10
uniform float u_separationWeight; // 2.0
uniform float u_alignWeight;      // 1.2
uniform float u_cohesionWeight;   // 1.5  — stronger cohesion than starlings
uniform float u_maxSpeed;         // 0.35
uniform float u_minSpeed;         // 0.10
uniform float u_maxForce;         // 2.5
uniform float u_predatorWeight;   // 5.0
uniform float u_predatorRadius;   // 0.30
uniform float u_ballCenterWeight; // 0.8  — attraction to school centroid
uniform float u_pressureWave;     // 0-1, injected by CPU on predator hit

// School centroid (updated CPU-side each frame)
uniform vec3  u_schoolCentroid;
uniform float u_boundaryRadius;   // 0.85
uniform float u_boundaryWeight;   // 2.5

#include "spatial_hash.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / u_agentTexSize;
    vec4 posData = texture2D(u_positionTex, uv);
    vec4 velData = texture2D(u_velocityTex, uv);
    vec3 pos = posData.rgb;
    vec3 vel = velData.rgb;
    // a = pressure phase (0-1, wave propagation state)
    float pressurePhase = velData.a;

    vec3 sepForce = vec3(0.0);
    vec3 alignSum = vec3(0.0);
    vec3 cohesSum = vec3(0.0);
    float sepCount = 0.0, alignCount = 0.0, cohesCount = 0.0;

    ivec3 myCell = worldToCell(pos);
    for (int dz = -1; dz <= 1; dz++) {
    for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
        ivec3 nc = myCell + ivec3(dx, dy, dz);
        if (any(lessThan(nc, ivec3(0))) || any(greaterThanEqual(nc, ivec3(HASH_GRID_DIM)))) continue;
        vec2 cr = cellRange(u_cellsTex, u_hashTexSize, cellIndex(nc));
        int start = int(cr.x); int count = int(cr.y);
        for (int k = 0; k < 32; k++) {
            if (k >= count) break;
            float nIdxNorm = hashEntry(u_hashTex, u_hashTexSize, start + k);
            vec2 nUV = agentUV(nIdxNorm, u_agentTexSize);
            if (abs(nUV.x - uv.x) < 1e-4 && abs(nUV.y - uv.y) < 1e-4) continue;

            vec3 nPos = texture2D(u_positionTex, nUV).rgb;
            vec3 nVel = texture2D(u_velocityTex, nUV).rgb;
            float nPhase = texture2D(u_velocityTex, nUV).a;
            vec3 diff = pos - nPos;
            float dist = length(diff);

            if (dist < u_separationRadius && dist > 0.0001) {
                sepForce += normalize(diff) / (dist * dist); // stronger repulsion for fish
                sepCount++;
            }
            if (dist < u_alignRadius) {
                alignSum += nVel;
                alignCount++;
            }
            if (dist < u_cohesionRadius) {
                cohesSum += nPos;
                cohesCount++;
                // Pressure wave propagation: neighbor's excited state infects us
                pressurePhase = max(pressurePhase, nPhase * 0.97);
            }
        }
    }}}

    vec3 steering = vec3(0.0);

    if (sepCount > 0.0) {
        vec3 desired = normalize(sepForce / sepCount) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_separationWeight;
    }
    if (alignCount > 0.0) {
        vec3 desired = normalize(alignSum / alignCount) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_alignWeight;
    }
    if (cohesCount > 0.0) {
        vec3 desired = normalize(cohesSum / cohesCount - pos) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_cohesionWeight;
    }

    // Ball centroid attraction — bait-ball holding force
    vec3 toCentroid = u_schoolCentroid - pos;
    float centDist = length(toCentroid);
    if (centDist > 0.001) {
        vec3 desired = normalize(toCentroid) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_ballCenterWeight;
    }

    // Pressure wave: excited fish accelerate outward (escape burst)
    float wavePush = pressurePhase * 2.0;
    if (wavePush > 0.01 && centDist > 0.001) {
        steering += normalize(pos - u_schoolCentroid) * wavePush * u_maxForce;
        pressurePhase *= 0.92; // decay
    }

    // Shark evasion
    if (u_predatorActive > 0.5) {
        vec3 toPred = pos - u_predatorPos;
        float dPred = length(toPred);
        if (dPred < u_predatorRadius) {
            float urgency = 1.0 - dPred / u_predatorRadius;
            // Inject pressure wave at this fish
            pressurePhase = max(pressurePhase, urgency);
            vec3 desired = normalize(toPred) * u_maxSpeed * 2.5;
            steering += clamp(desired - vel, -u_maxForce * 4.0, u_maxForce * 4.0) * u_predatorWeight * urgency;
        }
    }

    // Boundary
    float r = length(pos);
    if (r > u_boundaryRadius) {
        vec3 desired = -normalize(pos) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_boundaryWeight * (r - u_boundaryRadius) * 10.0;
    }

    vel += steering * u_dt;
    float speed = length(vel);
    if (speed > u_maxSpeed) vel = vel / speed * u_maxSpeed;
    if (speed < u_minSpeed && speed > 0.0001) vel = vel / speed * u_minSpeed;
    pos += vel * u_dt;

    // Inject CPU-triggered pressure wave
    pressurePhase = max(pressurePhase, u_pressureWave);

    gl_FragData[0] = vec4(pos, posData.a);
    gl_FragData[1] = vec4(vel, pressurePhase);
}
