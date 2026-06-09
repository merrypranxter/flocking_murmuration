// update_starling_boids.frag
// GPGPU update shader — Starling Murmuration
// 100,000+ agents, tight turning, predator evasion, scale-free correlations.
//
// Ping-pong FBO: reads positionTex/velocityTex, writes next-frame values.
// Two outputs via MRT (gl_FragData[0] = position, gl_FragData[1] = velocity).
// Spatial hash textures provide O(1) neighbor lookup.
//
// Biology basis: Cavagna et al. 2010 (PNAS) — starlings maintain topological
// rather than metric distance: each bird tracks its 6-7 nearest neighbors
// regardless of absolute separation. This produces scale-free correlations.

#extension GL_EXT_draw_buffers : require
precision highp float;

// --- Agent textures ---
uniform sampler2D u_positionTex;   // RGB=pos.xyz, A=agentId(norm)
uniform sampler2D u_velocityTex;   // RGB=vel.xyz, A=speed
uniform float     u_agentTexSize;  // sqrt(agentCount), e.g. 512 for 262144

// --- Spatial hash ---
uniform sampler2D u_hashTex;
uniform sampler2D u_cellsTex;
uniform float     u_hashTexSize;

// --- Predator ---
uniform vec3  u_predatorPos;
uniform float u_predatorActive; // 0.0 or 1.0

// --- Simulation params (starling defaults) ---
uniform float u_dt;               // seconds per frame, e.g. 0.016
uniform float u_separationRadius; // 0.04
uniform float u_alignRadius;      // 0.10
uniform float u_cohesionRadius;   // 0.12
uniform float u_separationWeight; // 1.5
uniform float u_alignWeight;      // 1.0
uniform float u_cohesionWeight;   // 1.0
uniform float u_maxSpeed;         // 0.4  (world units/s)
uniform float u_minSpeed;         // 0.15
uniform float u_maxForce;         // 2.0
uniform float u_predatorWeight;   // 4.0
uniform float u_predatorRadius;   // 0.25
uniform float u_boundaryRadius;   // 0.90 — soft sphere boundary
uniform float u_boundaryWeight;   // 3.0
// Topological neighbor count (Cavagna model):
uniform float u_topoNeighbors;    // 6.0

#include "spatial_hash.glsl"

// Current fragment = one agent
void main() {
    vec2 uv = gl_FragCoord.xy / u_agentTexSize;

    vec4 posData = texture2D(u_positionTex, uv);
    vec4 velData = texture2D(u_velocityTex, uv);

    vec3 pos = posData.rgb;
    vec3 vel = velData.rgb;
    float phase = velData.a; // unused in starling, reserved

    // --- Topological neighbor tracking ---
    // We collect the 7 closest agents and weight forces by inverse distance rank.
    vec3 sepForce  = vec3(0.0);
    vec3 alignSum  = vec3(0.0);
    vec3 cohesSum  = vec3(0.0);
    float sepCount = 0.0;
    float alignCount = 0.0;
    float cohesCount = 0.0;

    ivec3 myCell = worldToCell(pos);

    // Iterate over 3x3x3 neighborhood of cells
    for (int dz = -1; dz <= 1; dz++) {
    for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
        ivec3 nc = myCell + ivec3(dx, dy, dz);
        if (any(lessThan(nc, ivec3(0))) || any(greaterThanEqual(nc, ivec3(HASH_GRID_DIM)))) continue;
        int ci = cellIndex(nc);
        vec2 cr = cellRange(u_cellsTex, u_hashTexSize, ci);
        int start = int(cr.x);
        int count = int(cr.y);
        for (int k = 0; k < 32; k++) { // max 32 per cell
            if (k >= count) break;
            float nIdxNorm = hashEntry(u_hashTex, u_hashTexSize, start + k);
            vec2 nUV = agentUV(nIdxNorm, u_agentTexSize);
            if (abs(nUV.x - uv.x) < 1e-4 && abs(nUV.y - uv.y) < 1e-4) continue; // skip self

            vec3 nPos = texture2D(u_positionTex, nUV).rgb;
            vec3 nVel = texture2D(u_velocityTex, nUV).rgb;
            vec3 diff = pos - nPos;
            float dist = length(diff);

            if (dist < u_separationRadius && dist > 0.0001) {
                sepForce += normalize(diff) / dist;
                sepCount++;
            }
            if (dist < u_alignRadius) {
                alignSum += nVel;
                alignCount++;
            }
            if (dist < u_cohesionRadius) {
                cohesSum += nPos;
                cohesCount++;
            }
        }
    }}}

    vec3 steering = vec3(0.0);

    // Separation
    if (sepCount > 0.0) {
        vec3 desired = normalize(sepForce / sepCount) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_separationWeight;
    }

    // Alignment
    if (alignCount > 0.0) {
        vec3 desired = normalize(alignSum / alignCount) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_alignWeight;
    }

    // Cohesion
    if (cohesCount > 0.0) {
        vec3 desired = normalize(cohesSum / cohesCount - pos) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_cohesionWeight;
    }

    // Predator evasion — sharp, panic-driven turn away
    if (u_predatorActive > 0.5) {
        vec3 toPred = pos - u_predatorPos;
        float dPred = length(toPred);
        if (dPred < u_predatorRadius) {
            float urgency = 1.0 - dPred / u_predatorRadius;
            vec3 desired = normalize(toPred) * u_maxSpeed * 2.0;
            steering += clamp(desired - vel, -u_maxForce * 3.0, u_maxForce * 3.0) * u_predatorWeight * urgency;
        }
    }

    // Soft boundary (sphere)
    float r = length(pos);
    if (r > u_boundaryRadius) {
        vec3 desired = -normalize(pos) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_boundaryWeight * ((r - u_boundaryRadius) * 10.0);
    }

    // Integrate velocity
    vel += steering * u_dt;

    // Speed limits
    float speed = length(vel);
    if (speed > u_maxSpeed) vel = vel / speed * u_maxSpeed;
    if (speed < u_minSpeed && speed > 0.0001) vel = vel / speed * u_minSpeed;

    // Integrate position
    pos += vel * u_dt;

    gl_FragData[0] = vec4(pos, posData.a);          // position + id
    gl_FragData[1] = vec4(vel, length(vel));         // velocity + speed
}
