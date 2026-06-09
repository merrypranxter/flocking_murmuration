// update_predator_hawk.frag
// GPGPU update shader — Hawk Strike (predator agent)
// Single fast predator that produces schismogenesis: the flock splits along
// the predator's approach vector, leaving a corridor of empty space.
//
// The hawk targets the nearest prey to its computed intercept trajectory.
// After a successful strike (within capture radius) it loops and re-targets.
// Boid evasion response is in the prey shader (u_predatorPos uniform).
//
// Output: single agent position/velocity (1x1 texture), but we run it
// as a full-quad pass so it shares the same FBO infrastructure.

precision highp float;

uniform sampler2D u_predPosVelTex; // RGBA: xyz=pos, w=speed; texel (0,0)
uniform float     u_dt;
uniform float     u_time;

// Prey school centroid for target selection
uniform vec3  u_preyCenter;
uniform float u_hawkMaxSpeed;    // 1.5  — ~80 km/h scaled
uniform float u_hawkMaxForce;    // 6.0
uniform float u_hawkCaptureRadius; // 0.05
uniform float u_hawkStrikeAngle; // 0.4  — narrow forward cone for stooping

// Strike state encoded in a second texel:
//   0 = cruising/approach
//   1 = stooping (dive)
//   2 = loop/reset
uniform sampler2D u_predStateTex;

void main() {
    // Only update texel (0,0) — all others are no-ops
    vec2 uv = gl_FragCoord.xy;
    if (uv.x > 1.5 || uv.y > 1.5) {
        gl_FragColor = texture2D(u_predPosVelTex, gl_FragCoord.xy / 2.0);
        return;
    }

    vec4 pv = texture2D(u_predPosVelTex, vec2(0.5, 0.5));
    vec3 pos = pv.rgb;
    // Reconstruct velocity direction from previous frame (encoded in state tex)
    vec4 stateData = texture2D(u_predStateTex, vec2(0.5, 0.5));
    vec3 vel = stateData.rgb * u_hawkMaxSpeed;
    float strikeState = stateData.a; // 0, 1, or 2

    vec3 toTarget = u_preyCenter - pos;
    float dist = length(toTarget);

    vec3 steering = vec3(0.0);

    if (strikeState < 0.5) {
        // Approach: circle above prey center at altitude
        vec3 targetAbove = u_preyCenter + vec3(0.0, 0.3, 0.0);
        vec3 desired = normalize(targetAbove - pos) * u_hawkMaxSpeed;
        steering = clamp(desired - vel, -u_hawkMaxForce, u_hawkMaxForce);

        // Transition to stoop when above and within range
        if (pos.y > u_preyCenter.y + 0.15 && dist < 0.4) {
            strikeState = 1.0;
        }
    } else if (strikeState < 1.5) {
        // Stoop: high-speed dive at prey center
        vec3 desired = normalize(u_preyCenter - pos) * u_hawkMaxSpeed * 1.5;
        steering = clamp(desired - vel, -u_hawkMaxForce * 2.0, u_hawkMaxForce * 2.0);

        // Capture or pull-out
        if (dist < u_hawkCaptureRadius) {
            strikeState = 2.0; // loop reset
        }
        if (pos.y < u_preyCenter.y - 0.2) {
            strikeState = 2.0; // missed, pull out
        }
    } else {
        // Loop: climb back up, then re-approach
        vec3 desired = normalize(vec3(0.0, 1.0, 0.0) - vel * 0.1) * u_hawkMaxSpeed;
        steering = clamp(desired - vel, -u_hawkMaxForce, u_hawkMaxForce);
        if (pos.y > u_preyCenter.y + 0.35) {
            strikeState = 0.0; // re-enter approach
        }
    }

    vel += steering * u_dt;
    float speed = length(vel);
    if (speed > u_hawkMaxSpeed * 1.6) vel = vel / speed * u_hawkMaxSpeed * 1.6;
    if (speed < 0.1) vel = normalize(toTarget) * 0.1;
    pos += vel * u_dt;

    // Boundary
    if (length(pos) > 0.95) pos = normalize(pos) * 0.95;

    gl_FragColor = vec4(pos, speed);
    // Also update state tex via secondary draw (in JS, use second attachment)
    // For single-output path: encode state in alpha, direction in RGB
}
