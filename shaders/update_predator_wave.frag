// update_predator_wave.frag
// GPGPU update shader — Wave Front / Linear Pressure Wave
// Not a physical predator but a moving pressure wave (planar or spherical)
// that sweeps through the flock, triggering a cascade of escape responses.
// Models shorebird escape waves, aerial predator passes, or sudden noise events.
//
// The wave is parameterized as a signed-distance plane:
//   wavePos = origin + u_waveDir * u_waveSpeed * u_time
// When a boid crosses the wave front (dist changes sign), it receives a
// strong panic-kick orthogonal to the wave direction, and the panic decays.

precision highp float;

// This shader just advances the wave plane position — boid reactions
// are handled by the prey update shader reading u_wavePos / u_waveDir.
// The predator "position" output is the wave plane's leading edge point.

uniform float u_dt;
uniform float u_time;
uniform vec3  u_waveOrigin;  // initial wave position (world)
uniform vec3  u_waveDir;     // unit vec3 propagation direction
uniform float u_waveSpeed;   // 0.20  — wave front travel speed

void main() {
    // Advance wave front position
    float dist = u_waveSpeed * u_time;
    vec3 frontPos = u_waveOrigin + u_waveDir * dist;

    // Wraparound: if wave has exited the bounding sphere, restart
    if (length(frontPos) > 1.1) {
        frontPos = u_waveOrigin; // CPU will detect and reset u_time
    }

    // Output the wave front's center point as the "predator" position
    gl_FragColor = vec4(frontPos, u_waveSpeed);
}
