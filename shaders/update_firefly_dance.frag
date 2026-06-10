// update_firefly_dance.frag
// GPGPU update shader — Firefly Dance / Synchronous Flash
// 10,000 agents, phase-coupled Kuramoto oscillators, attractor sync.
//
// Synchronous firefly (Photinus carolinus) swarms in Great Smoky Mountains
// produce traveling light waves through phase coupling: each firefly advances
// or retards its flash phase based on neighbors' phases (Kuramoto model).
// Spatial motion is gentle hovering; the display behavior is the phase sync.
//
// Phase texture (velData.a) encodes blink phase in [0, 1].
// Flash occurs near phase = 0.0 (delta region < u_flashWidth).
//
// Biology: Buck & Buck 1976; Mirollo & Strogatz 1990; Smith 1935.

#extension GL_EXT_draw_buffers : require
precision highp float;

uniform sampler2D u_positionTex;
uniform sampler2D u_velocityTex;
uniform float     u_agentTexSize;

uniform sampler2D u_hashTex;
uniform sampler2D u_cellsTex;
uniform float     u_hashTexSize;

uniform float u_dt;
uniform float u_time;
uniform float u_separationRadius; // 0.04
uniform float u_alignRadius;      // 0.06  — gentle alignment
uniform float u_cohesionRadius;   // 0.10
uniform float u_separationWeight; // 1.0
uniform float u_alignWeight;      // 0.3
uniform float u_cohesionWeight;   // 0.5
uniform float u_maxSpeed;         // 0.08  — very slow hover
uniform float u_minSpeed;         // 0.0
uniform float u_maxForce;         // 0.5
// Kuramoto coupling constant
uniform float u_kCoupling;        // 0.8   — phase coupling strength
uniform float u_naturalFreq;      // 1.0   — natural flash frequency (Hz)
uniform float u_flashWidth;       // 0.05  — phase width of visible flash
uniform float u_phaseRadius;      // 0.12  — radius for phase coupling
// Attractor: all agents drift toward central display zone
uniform vec3  u_attractorPos;
uniform float u_attractorWeight;  // 0.2
uniform float u_boundaryRadius;   // 0.60
uniform float u_boundaryWeight;   // 3.0

#include "spatial_hash.glsl"

float rand(vec2 co, float seed) {
    return fract(sin(dot(co + seed, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_agentTexSize;
    vec4 posData = texture2D(u_positionTex, uv);
    vec4 velData = texture2D(u_velocityTex, uv);
    vec3 pos = posData.rgb;
    vec3 vel = velData.rgb;
    float phase = velData.a; // Kuramoto phase [0, 1]

    vec3 sepForce = vec3(0.0);
    vec3 alignSum = vec3(0.0);
    vec3 cohesSum = vec3(0.0);
    float sepCount = 0.0, alignCount = 0.0, cohesCount = 0.0;
    float phaseSync = 0.0;
    float phaseSyncCount = 0.0;

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
                sepForce += normalize(diff) / dist;
                sepCount++;
            }
            if (dist < u_alignRadius) { alignSum += nVel; alignCount++; }
            if (dist < u_cohesionRadius) { cohesSum += nPos; cohesCount++; }

            // Kuramoto phase coupling: sin(neighbor_phase - my_phase) drives sync
            if (dist < u_phaseRadius) {
                float phaseDiff = (nPhase - phase) * 6.28318; // to radians
                phaseSync += sin(phaseDiff);
                phaseSyncCount++;
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

    // Gentle hover: small random drift to keep fireflies from stagnating
    float noiseSeed = u_time * 0.05 + phase * 7.3;
    vec3 drift = vec3(
        sin(noiseSeed + pos.x * 5.0) * 0.1,
        cos(noiseSeed * 1.3 + pos.y * 4.0) * 0.05,
        sin(noiseSeed * 0.7 + pos.z * 6.0) * 0.1
    ) * u_maxForce * 0.3;
    steering += drift;

    // Attractor
    vec3 toAttr = u_attractorPos - pos;
    if (length(toAttr) > 0.001) {
        steering += normalize(toAttr) * u_attractorWeight * u_maxForce;
    }

    // Boundary
    float r = length(pos);
    if (r > u_boundaryRadius) {
        steering += -normalize(pos) * u_boundaryWeight * (r - u_boundaryRadius) * 10.0;
    }

    vel += steering * u_dt;
    float speed = length(vel);
    if (speed > u_maxSpeed) vel = vel / speed * u_maxSpeed;
    pos += vel * u_dt;

    // Kuramoto phase update: dθ/dt = ω + (K/N) * Σ sin(θ_j - θ_i)
    float dPhase = u_naturalFreq * u_dt;
    if (phaseSyncCount > 0.0) {
        dPhase += (u_kCoupling / phaseSyncCount) * phaseSync * u_dt;
    }
    phase = fract(phase + dPhase);

    gl_FragData[0] = vec4(pos, posData.a);
    gl_FragData[1] = vec4(vel, phase);
}
