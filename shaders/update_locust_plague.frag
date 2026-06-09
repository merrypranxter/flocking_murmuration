// update_locust_plague.frag
// GPGPU update shader — Locust Plague
// 80,000 agents, aligned marching, density-dependent phase shift (solitarious→gregarious).
//
// The desert locust (Schistocerca gregaria) undergoes a remarkable phase
// transition: at low density individuals are solitary and avoid each other;
// above ~25 insects/m² they adopt a gregarious phase with aligned marching
// and mutual attraction. This is modeled via a density-dependent weight flip.
//
// Phase channels (velData.a):
//   0.0 = solitarious (solitary, avoidant)
//   1.0 = gregarious  (social, aligned marcher)
// Transition is continuous, driven by local density (sepCount + cohesCount).
//
// Marching direction: +X by default; wind and slope uniforms tilt the heading.
// Biology: Buhl et al. 2006 (Science); Uvarov 1966.

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
uniform float u_separationRadius; // 0.03
uniform float u_alignRadius;      // 0.08
uniform float u_cohesionRadius;   // 0.10
uniform float u_maxSpeed;         // 0.30
uniform float u_minSpeed;         // 0.05
uniform float u_maxForce;         // 2.0
// Phase transition threshold (normalized density count)
uniform float u_gregariousThreshold; // 8.0 neighbors triggers gregarious shift
uniform float u_phaseTransitionRate; // 0.05 per frame
// March direction (unit vec3, typically +X)
uniform vec3  u_marchDir;         // default (1,0,0)
uniform float u_marchWeight;      // 1.0 — base march force in gregarious phase
// Ground: agents prefer y ≈ 0.0 (ground plane)
uniform float u_groundY;          // 0.0
uniform float u_groundWeight;     // 1.5
uniform float u_boundaryRadius;   // 0.90
uniform float u_boundaryWeight;   // 2.0

#include "spatial_hash.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / u_agentTexSize;
    vec4 posData = texture2D(u_positionTex, uv);
    vec4 velData = texture2D(u_velocityTex, uv);
    vec3 pos = posData.rgb;
    vec3 vel = velData.rgb;
    float gregPhase = velData.a; // 0=solitarious, 1=gregarious

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
            vec3 diff = pos - nPos;
            float dist = length(diff);

            if (dist < u_separationRadius && dist > 0.0001) {
                sepForce += normalize(diff) / dist;
                sepCount++;
            }
            if (dist < u_alignRadius) { alignSum += nVel; alignCount++; }
            if (dist < u_cohesionRadius) { cohesSum += nPos; cohesCount++; }
        }
    }}}

    // Density estimate from neighbor count
    float localDensity = sepCount + cohesCount * 0.5;
    // Phase transition
    if (localDensity > u_gregariousThreshold) {
        gregPhase = min(1.0, gregPhase + u_phaseTransitionRate * u_dt * 60.0);
    } else {
        gregPhase = max(0.0, gregPhase - u_phaseTransitionRate * 0.5 * u_dt * 60.0);
    }

    // Weights flip with phase:
    // Solitarious: strong separation, no alignment, weak cohesion
    // Gregarious:  weak separation, strong alignment + march, strong cohesion
    float sepWeight   = mix(3.0,  0.8,  gregPhase);
    float alignWeight = mix(0.0,  1.5,  gregPhase);
    float cohesWeight = mix(0.0,  1.2,  gregPhase);

    vec3 steering = vec3(0.0);

    if (sepCount > 0.0) {
        vec3 desired = normalize(sepForce / sepCount) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * sepWeight;
    }
    if (alignCount > 0.0) {
        vec3 desired = normalize(alignSum / alignCount) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * alignWeight;
    }
    if (cohesCount > 0.0) {
        vec3 desired = normalize(cohesSum / cohesCount - pos) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * cohesWeight;
    }

    // March force (only gregarious)
    if (gregPhase > 0.1) {
        vec3 marchDesired = u_marchDir * u_maxSpeed;
        steering += clamp(marchDesired - vel, -u_maxForce, u_maxForce) * u_marchWeight * gregPhase;
    }

    // Ground adhesion
    float yErr = u_groundY - pos.y;
    steering += vec3(0.0, yErr * u_groundWeight, 0.0);

    // Boundary
    float r = length(pos);
    if (r > u_boundaryRadius) {
        steering += -normalize(pos) * u_boundaryWeight * (r - u_boundaryRadius) * 10.0;
    }

    vel += steering * u_dt;
    float speed = length(vel);
    if (speed > u_maxSpeed) vel = vel / speed * u_maxSpeed;
    if (speed < u_minSpeed && speed > 0.0001) vel = vel / speed * u_minSpeed;
    pos += vel * u_dt;

    // Clamp to ground level
    if (pos.y < u_groundY) { pos.y = u_groundY; vel.y = abs(vel.y) * 0.2; }

    gl_FragData[0] = vec4(pos, posData.a);
    gl_FragData[1] = vec4(vel, gregPhase);
}
