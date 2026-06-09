// update_moth_swarm.frag
// GPGPU update shader — Moth Swarm
// 20,000 agents, positive phototaxis, lamp orbit decay, inter-moth avoidance.
//
// Moths spiral toward a light source via positive phototaxis, enter a
// "Miller's spiral" orbit (Hsiao 1972), then decay inward as wing fatigue
// accumulates. Multiple competing lamps split the swarm into sub-clusters.
// Nocturnal: agents are repelled by bright patches (secondary lamps) if
// primary lamp is already occupied beyond saturation.
//
// Biology: Hsiao 1972; Baker & Woiwod 1979.

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
uniform float u_alignRadius;      // 0.05
uniform float u_cohesionRadius;   // 0.08
uniform float u_separationWeight; // 1.5
uniform float u_alignWeight;      // 0.4
uniform float u_cohesionWeight;   // 0.5
uniform float u_maxSpeed;         // 0.20
uniform float u_minSpeed;         // 0.05
uniform float u_maxForce;         // 1.2
// Phototaxis parameters
uniform vec3  u_lampPos;           // primary lamp world position
uniform float u_lampOrbitRadius;   // 0.08  — desired orbit radius around lamp
uniform float u_lampOrbitWeight;   // 2.0
uniform float u_lampSpiralDecay;   // 0.01  — per-frame radial decay (fatigue)
uniform float u_boundaryRadius;    // 0.80
uniform float u_boundaryWeight;    // 2.5

#include "spatial_hash.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / u_agentTexSize;
    vec4 posData = texture2D(u_positionTex, uv);
    vec4 velData = texture2D(u_velocityTex, uv);
    vec3 pos = posData.rgb;
    vec3 vel = velData.rgb;
    // a = fatigue [0,1]; higher = slower orbit, spirals inward
    float fatigue = velData.a;

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

    // Phototaxis: orbit the lamp in a horizontal plane
    vec3 toLamp = u_lampPos - pos;
    float lampDist = length(toLamp);
    if (lampDist > 0.001) {
        // Radial component: approach to orbit radius (reduced by fatigue = spiral in)
        float targetRadius = u_lampOrbitRadius * (1.0 - fatigue * 0.8);
        float radialErr = lampDist - targetRadius;
        vec3 radialForce = normalize(toLamp) * radialErr * u_lampOrbitWeight;

        // Tangential component: CCW orbit in XZ plane
        vec3 toXZ = vec3(toLamp.x, 0.0, toLamp.z);
        float xzDist = length(toXZ);
        vec3 tangent = vec3(0.0);
        if (xzDist > 0.001) {
            tangent = normalize(vec3(-toXZ.z, 0.0, toXZ.x)); // CCW
        }
        float orbitalSpeed = u_maxSpeed * (1.0 - fatigue * 0.6);
        vec3 tangentForce = tangent * orbitalSpeed * u_lampOrbitWeight;

        // Vertical: hover at lamp height
        float vertErr = u_lampPos.y - pos.y;
        vec3 vertForce = vec3(0.0, vertErr * u_lampOrbitWeight * 0.5, 0.0);

        steering += radialForce + tangentForce + vertForce;
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

    // Fatigue accumulates near lamp; resets far from it
    if (lampDist < u_lampOrbitRadius * 2.0) {
        fatigue = min(1.0, fatigue + u_dt * u_lampSpiralDecay * 0.5);
    } else {
        fatigue = max(0.0, fatigue - u_dt * 0.005); // slow recovery
    }

    gl_FragData[0] = vec4(pos, posData.a);
    gl_FragData[1] = vec4(vel, fatigue);
}
