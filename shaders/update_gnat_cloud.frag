// update_gnat_cloud.frag
// GPGPU update shader — Gnat Cloud
// 50,000 agents, Brownian jitter, chaotic attractor core, swarm center hold.
//
// Gnat swarms hover over a fixed point (landmark or thermal) with
// apparently random individual motion but a stable collective shape.
// The cloud is held by a weak attraction to the swarm centroid competing
// with correlated random-walk noise — the Brownian diffusion coefficient
// governs cloud density. In mating swarms, males converge faster than females.
//
// Biology: Okubo 1986; Okubo & Chiang 1974.

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
uniform float u_separationRadius; // 0.02
uniform float u_alignRadius;      // 0.04  — gnats barely align
uniform float u_cohesionRadius;   // 0.08
uniform float u_separationWeight; // 1.2
uniform float u_alignWeight;      // 0.2   — very weak alignment
uniform float u_cohesionWeight;   // 0.6
uniform float u_maxSpeed;         // 0.25
uniform float u_minSpeed;         // 0.0   — gnats can hover
uniform float u_maxForce;         // 1.5
uniform float u_noiseStrength;    // 0.8   — Brownian jitter intensity
uniform float u_attractorWeight;  // 1.0   — chaotic-attractor pull weight
uniform vec3  u_swarmAnchor;      // world-space anchor point (landmark)
uniform float u_anchorWeight;     // 0.5
uniform float u_boundaryRadius;   // 0.70
uniform float u_boundaryWeight;   // 3.0

#include "spatial_hash.glsl"

// Pseudo-random: hash of (uv, time, seed)
float rand(vec2 co, float seed) {
    return fract(sin(dot(co + seed, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 randVec3(vec2 co, float seed) {
    return vec3(rand(co, seed), rand(co, seed + 1.3), rand(co, seed + 2.7)) * 2.0 - 1.0;
}

// Lorenz-like chaotic attractor step (discrete approximation)
// Used as a "virtual predator" path that the swarm never quite escapes.
vec3 lorenzStep(vec3 p, float dt) {
    float sigma = 10.0, rho = 28.0, beta = 2.667;
    float dx = sigma * (p.y - p.x);
    float dy = p.x * (rho - p.z) - p.y;
    float dz = p.x * p.y - beta * p.z;
    return p + vec3(dx, dy, dz) * dt * 0.005; // scaled to world
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_agentTexSize;
    vec4 posData = texture2D(u_positionTex, uv);
    vec4 velData = texture2D(u_velocityTex, uv);
    vec3 pos = posData.rgb;
    vec3 vel = velData.rgb;
    float phase = velData.a; // individual phase offset for async jitter

    // Per-agent random noise (Brownian)
    float seed = u_time * 0.1 + phase * 100.0;
    vec3 brownian = randVec3(uv, seed) * u_noiseStrength;

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

    vec3 steering = brownian; // noise is additive, not a steering force

    if (sepCount > 0.0) {
        steering += normalize(sepForce / sepCount) * u_separationWeight * u_maxForce;
    }
    if (alignCount > 0.0) {
        vec3 desired = normalize(alignSum / alignCount) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_alignWeight;
    }
    if (cohesCount > 0.0) {
        vec3 desired = normalize(cohesSum / cohesCount - pos) * u_maxSpeed;
        steering += clamp(desired - vel, -u_maxForce, u_maxForce) * u_cohesionWeight;
    }

    // Anchor attraction — swarm stays over landmark
    vec3 toAnchor = u_swarmAnchor - pos;
    float anchorDist = length(toAnchor);
    if (anchorDist > 0.001) {
        // Quadratic well: force grows with distance^2, prevents escape
        float pull = anchorDist * anchorDist * u_anchorWeight;
        steering += normalize(toAnchor) * min(pull, u_maxForce);
    }

    // Boundary
    float r = length(pos);
    if (r > u_boundaryRadius) {
        steering += -normalize(pos) * u_boundaryWeight * (r - u_boundaryRadius) * 10.0;
    }

    vel += steering * u_dt;
    float speed = length(vel);
    if (speed > u_maxSpeed) vel = vel / speed * u_maxSpeed;
    // Gnats can hover (no minSpeed)
    pos += vel * u_dt;

    // Phase drift (for asynchronous visual jitter in render shader)
    phase = fract(phase + u_dt * 0.3);

    gl_FragData[0] = vec4(pos, posData.a);
    gl_FragData[1] = vec4(vel, phase);
}
