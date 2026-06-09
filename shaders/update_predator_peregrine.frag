// update_predator_peregrine.frag
// GPGPU update shader — Peregrine Falcon Dive
// Vertical splitting attack from above; fastest animal dive (~320 km/h).
// Produces a vertical flock-split: the flock cleaves along a vertical axis
// as the falcon stoops, then reforms beneath.
//
// States: 0=climb  1=stoop (fold wings, terminal velocity dive)  2=pull-up

precision highp float;

uniform sampler2D u_predPosVelTex;
uniform sampler2D u_predStateTex;
uniform float     u_dt;
uniform vec3      u_preyCenter;
uniform float     u_falconMaxSpeed;     // 2.5 — much faster than hawk
uniform float     u_falconMaxForce;     // 8.0
uniform float     u_falconCaptureRadius; // 0.04
uniform float     u_stoopDragCoeff;     // 0.1 — very low drag in stoop

void main() {
    vec2 uv = gl_FragCoord.xy;
    if (uv.x > 1.5 || uv.y > 1.5) {
        gl_FragColor = texture2D(u_predPosVelTex, gl_FragCoord.xy / 2.0);
        return;
    }

    vec4 pv       = texture2D(u_predPosVelTex, vec2(0.5, 0.5));
    vec4 stateData = texture2D(u_predStateTex,  vec2(0.5, 0.5));
    vec3 pos  = pv.rgb;
    vec3 vel  = stateData.rgb * pv.a; // stateData.rgb = normalized dir, pv.a = speed
    float state = stateData.a;

    vec3 steering = vec3(0.0);

    if (state < 0.5) {
        // Climb phase: gain altitude directly above prey
        vec3 target = u_preyCenter + vec3(0.0, 0.5, 0.0);
        vec3 desired = normalize(target - pos) * u_falconMaxSpeed * 0.6;
        steering = clamp(desired - vel, -u_falconMaxForce, u_falconMaxForce);
        if (pos.y > u_preyCenter.y + 0.45) state = 1.0;
    } else if (state < 1.5) {
        // Stoop: wings folded — use gravity-assisted dive toward prey
        // Gravity adds terminal velocity; very low drag
        vec3 gravity = vec3(0.0, -0.8, 0.0);
        vec3 desired = normalize(u_preyCenter - pos) * u_falconMaxSpeed;
        steering = clamp(desired - vel, -u_falconMaxForce * 2.0, u_falconMaxForce * 2.0);
        steering += gravity;
        // Dampen horizontal drag in stoop (streamlined)
        vel.xz -= vel.xz * u_stoopDragCoeff;

        float dist = length(u_preyCenter - pos);
        if (dist < u_falconCaptureRadius || pos.y < u_preyCenter.y - 0.15) {
            state = 2.0;
        }
    } else {
        // Pull-up: wings open, hard upward turn
        vec3 desired = normalize(vec3(vel.x, abs(vel.y) + 0.5, vel.z)) * u_falconMaxSpeed;
        steering = clamp(desired - vel, -u_falconMaxForce * 1.5, u_falconMaxForce * 1.5);
        if (pos.y > u_preyCenter.y + 0.15 && vel.y > 0.0) state = 0.0;
    }

    vel += steering * u_dt;
    float speed = length(vel);
    if (speed > u_falconMaxSpeed * 2.0) vel = vel / speed * u_falconMaxSpeed * 2.0;
    pos += vel * u_dt;
    if (length(pos) > 0.95) pos = normalize(pos) * 0.95;

    gl_FragColor = vec4(pos, speed);
}
