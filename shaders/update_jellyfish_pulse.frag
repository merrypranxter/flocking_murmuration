// update_jellyfish_pulse.frag
// GPGPU update shader — Jellyfish Pulse / Smack
// 15,000 agents, radial contraction-expansion pulse, fluid coupling (Stokes drag),
// passive drift, vertical migration (diel).
//
// A jellyfish bloom (smack) is not a tight flock: individuals are loosely coupled
// through fluid wake interactions and light-driven depth preferences.
// Each jellyfish has an intrinsic pulsation rate; the contraction phase drives
// upward propulsion. Groups tend to aggregate at thermocline depth.
//
// The pulse cycle drives both locomotion and visual appearance:
//   phase 0.0–0.3  = contraction (jet stroke)  → upward surge, bell contracts
//   phase 0.3–1.0  = relaxation (recovery)      → slow drift down, bell expands
//
// Biology: Costello & Colin 1994; Hamner et al. 1994; Uye & Shimauchi 2005.

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
uniform float u_separationRadius;  // 0.06  — wide personal space
uniform float u_cohesionRadius;    // 0.20  — loose aggregation
uniform float u_separationWeight;  // 1.0
uniform float u_cohesionWeight;    // 0.3   — very gentle cohesion
uniform float u_maxSpeed;          // 0.15
uniform float u_minSpeed;          // 0.0
uniform float u_maxForce;          // 0.8
// Pulse parameters
uniform float u_pulseFreq;         // 0.7   — pulses/second
uniform float u_jetStrength;       // 1.2   — upward force during contraction
uniform float u_contractionPhase;  // 0.30  — fraction of cycle = jet stroke
// Fluid / environment
uniform float u_buoyancy;          // 0.05  — net upward passive drift
uniform float u_dragCoeff;         // 0.4   — Stokes drag
uniform float u_currentDir;        // angle in XZ plane of ambient current
uniform float u_currentSpeed;      // 0.02
// Depth preference (thermocline)
uniform float u_preferredDepth;    // preferred Y position (e.g. -0.3)
uniform float u_depthWeight;       // 0.5
uniform float u_boundaryRadius;    // 0.80
uniform float u_boundaryWeight;    // 2.0

#include "spatial_hash.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / u_agentTexSize;
    vec4 posData = texture2D(u_positionTex, uv);
    vec4 velData = texture2D(u_velocityTex, uv);
    vec3 pos = posData.rgb;
    vec3 vel = velData.rgb;
    float pulsePhase = velData.a; // [0,1] — individual bell phase

    vec3 sepForce = vec3(0.0);
    vec3 cohesSum = vec3(0.0);
    float sepCount = 0.0, cohesCount = 0.0;

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
            vec3 diff = pos - nPos;
            float dist = length(diff);

            if (dist < u_separationRadius && dist > 0.0001) {
                sepForce += normalize(diff) / dist;
                sepCount++;
            }
            if (dist < u_cohesionRadius) { cohesSum += nPos; cohesCount++; }
        }
    }}}

    vec3 force = vec3(0.0);

    if (sepCount > 0.0) {
        force += normalize(sepForce / sepCount) * u_separationWeight * u_maxForce;
    }
    if (cohesCount > 0.0) {
        vec3 desired = normalize(cohesSum / cohesCount - pos) * u_maxSpeed;
        force += clamp(desired - vel, -u_maxForce, u_maxForce) * u_cohesionWeight;
    }

    // Pulsation jet: upward force during contraction phase
    float inJet = step(pulsePhase, u_contractionPhase); // 1.0 during jet stroke
    float jetPower = inJet * sin(pulsePhase / u_contractionPhase * 3.14159);
    force += vec3(0.0, 1.0, 0.0) * jetPower * u_jetStrength;

    // Passive buoyancy
    force += vec3(0.0, u_buoyancy, 0.0);

    // Depth preference
    float depthErr = u_preferredDepth - pos.y;
    force += vec3(0.0, depthErr * u_depthWeight, 0.0);

    // Ambient current
    vec3 current = vec3(cos(u_currentDir), 0.0, sin(u_currentDir)) * u_currentSpeed;
    force += (current - vel) * u_dragCoeff;

    // Stokes drag
    force -= vel * u_dragCoeff;

    // Boundary
    float r = length(pos);
    if (r > u_boundaryRadius) {
        force += -normalize(pos) * u_boundaryWeight * (r - u_boundaryRadius) * 10.0;
    }

    vel += force * u_dt;
    float speed = length(vel);
    if (speed > u_maxSpeed) vel = vel / speed * u_maxSpeed;
    pos += vel * u_dt;

    // Advance pulse phase
    pulsePhase = fract(pulsePhase + u_pulseFreq * u_dt);

    gl_FragData[0] = vec4(pos, posData.a);
    gl_FragData[1] = vec4(vel, pulsePhase);
}
