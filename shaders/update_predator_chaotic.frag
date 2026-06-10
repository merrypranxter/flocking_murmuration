// update_predator_chaotic.frag
// GPGPU update shader — Chaotic Attractor Predator
// The predator's path follows a Lorenz strange attractor trajectory.
// This produces an unpredictable, swooping "ghost predator" that never
// repeats its path — causing continuous low-level panic in the flock
// without any single decisive strike.
//
// The Lorenz system (σ=10, ρ=28, β=8/3) produces a butterfly-shaped
// attractor. We integrate it with a small dt and scale to world units.
// The predator is always "active" but the boids only react when it
// comes within u_predatorRadius.

precision highp float;

uniform sampler2D u_predPosVelTex;
uniform float     u_dt;
uniform float     u_lorenzScale;   // 0.015 — maps Lorenz units to world units
uniform float     u_lorenzSpeed;   // 1.0   — integration rate multiplier

// Lorenz parameters
uniform float u_sigma; // 10.0
uniform float u_rho;   // 28.0
uniform float u_beta;  // 2.667

void main() {
    vec2 uv = gl_FragCoord.xy;
    if (uv.x > 1.5 || uv.y > 1.5) {
        gl_FragColor = texture2D(u_predPosVelTex, gl_FragCoord.xy / 2.0);
        return;
    }

    vec4 pv = texture2D(u_predPosVelTex, vec2(0.5, 0.5));
    // Store Lorenz state (unscaled) in the texture:
    //   pv.rgb = scaled world pos, pv.a = lorenz state hash
    // We encode the full Lorenz state in an auxiliary texture.
    // For single-output, we integrate in raw Lorenz space and scale.

    // Read Lorenz state from auxiliary pv (encoded as offset from origin)
    // World pos = lorenzState * u_lorenzScale + vec3(0, 0.2, 0)
    vec3 lorenzState = pv.rgb / u_lorenzScale;

    // RK4 integration of Lorenz system
    float h = u_dt * u_lorenzSpeed * 10.0; // Lorenz needs faster integration

    vec3 k1, k2, k3, k4, s;

    s = lorenzState;
    k1 = vec3(u_sigma*(s.y-s.x), s.x*(u_rho-s.z)-s.y, s.x*s.y-u_beta*s.z);

    s = lorenzState + k1 * (h * 0.5);
    k2 = vec3(u_sigma*(s.y-s.x), s.x*(u_rho-s.z)-s.y, s.x*s.y-u_beta*s.z);

    s = lorenzState + k2 * (h * 0.5);
    k3 = vec3(u_sigma*(s.y-s.x), s.x*(u_rho-s.z)-s.y, s.x*s.y-u_beta*s.z);

    s = lorenzState + k3 * h;
    k4 = vec3(u_sigma*(s.y-s.x), s.x*(u_rho-s.z)-s.y, s.x*s.y-u_beta*s.z);

    lorenzState += (k1 + 2.0*k2 + 2.0*k3 + k4) * (h / 6.0);

    // Scale Lorenz to world space (Lorenz attractor spans ~[-20,20])
    vec3 worldPos = lorenzState * u_lorenzScale;
    // Clamp to world boundary
    if (length(worldPos) > 0.90) worldPos = normalize(worldPos) * 0.90;

    float speed = length((worldPos - pv.rgb) / u_dt);

    gl_FragColor = vec4(worldPos, speed);
}
