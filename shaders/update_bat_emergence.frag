// update_bat_emergence.frag
// GPGPU update shader — Bat Emergence
// 30,000 agents, cave-exit vortex, echolocation repulsion rings, dusk foraging.
//
// Mexican free-tailed bat emergences produce counter-clockwise vortex columns
// as 1–5 million bats funnel out of cave entrances. Individual bats use
// echolocation, creating repulsion bubbles of ~0.3 m radius. After emergence
// the column disperses into foraging spread.
//
// Three simulation phases (encoded in u_emergencePhase):
//   0.0 = tunnel / pre-emergence queue
//   1.0 = vortex column exit
//   2.0 = dispersal / foraging spread
//
// Biology: Betke et al. 2008 (tracking 20M bats); Gillam et al. 2007.

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
uniform float u_separationRadius; // 0.03  — echolocation repulsion radius
uniform float u_alignRadius;      // 0.08
uniform float u_cohesionRadius;   // 0.10
uniform float u_separationWeight; // 2.5
uniform float u_alignWeight;      // 0.9
uniform float u_cohesionWeight;   // 0.7
uniform float u_maxSpeed;         // 0.45
uniform float u_minSpeed;         // 0.15
uniform float u_maxForce;         // 2.0
uniform float u_emergencePhase;   // 0-2 (see above)
uniform vec3  u_caveExit;         // world position of cave mouth
uniform float u_vortexStrength;   // 1.5 — CCW column spin
uniform float u_vortexRadius;     // 0.05 — column radius
uniform float u_dispersalWeight;  // 0.4 — outward spread in phase 2
uniform float u_boundaryRadius;   // 0.90
uniform float u_boundaryWeight;   // 2.0

#include "spatial_hash.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / u_agentTexSize;
    vec4 posData = texture2D(u_positionTex, uv);
    vec4 velData = texture2D(u_velocityTex, uv);
    vec3 pos = posData.rgb;
    vec3 vel = velData.rgb;
    float echoPhase = velData.a; // echolocation pulse phase

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
            float nEcho = texture2D(u_velocityTex, nUV).a;
            vec3 diff = pos - nPos;
            float dist = length(diff);

            // Echolocation ring: when neighbor's echo pulse is active (peak),
            // treat as hard repulsion even if outside normal separation radius.
            float echoBump = max(0.0, 1.0 - abs(nEcho - 0.5) * 2.0); // peaks at phase=0.5
            float effectiveSepR = u_separationRadius * (1.0 + echoBump * 0.5);

            if (dist < effectiveSepR && dist > 0.0001) {
                sepForce += normalize(diff) / dist * (1.0 + echoBump);
                sepCount++;
            }
            if (dist < u_alignRadius) { alignSum += nVel; alignCount++; }
            if (dist < u_cohesionRadius) { cohesSum += nPos; cohesCount++; }
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

    // Phase 1: Vortex column
    if (u_emergencePhase > 0.5 && u_emergencePhase < 1.5) {
        // Project pos onto horizontal plane around cave exit
        vec3 radial = pos - u_caveExit;
        radial.y = 0.0; // horizontal component
        float radDist = length(radial);
        if (radDist > 0.001) {
            // CCW tangent (right-hand rule, up=+Y)
            vec3 tangent = normalize(vec3(-radial.z, 0.0, radial.x));
            // Upward column flow
            vec3 upward = vec3(0.0, 1.0, 0.0);
            // Force toward column radius + CCW spin
            float columnPull = (radDist - u_vortexRadius) * 2.0;
            steering += tangent * u_vortexStrength;
            steering += upward * u_vortexStrength * 0.5;
            steering -= normalize(radial) * columnPull * u_vortexStrength;
        }
    }

    // Phase 2: Dispersal (foraging spread)
    if (u_emergencePhase > 1.5) {
        float r = length(pos - u_caveExit);
        if (r > 0.001) {
            steering += normalize(pos - u_caveExit) * u_dispersalWeight * u_maxForce;
        }
    }

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

    // Advance echolocation pulse
    echoPhase = fract(echoPhase + u_dt * 8.0); // ~8 Hz call rate

    gl_FragData[0] = vec4(pos, posData.a);
    gl_FragData[1] = vec4(vel, echoPhase);
}
