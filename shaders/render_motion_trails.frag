// render_motion_trails.frag
// Fragment shader — Motion blur trail rendering.
// Paired with render_motion_trails.vert.
// Additive blending creates luminous ribbon effect.

precision highp float;

varying float v_alpha;
varying vec3  v_color;
varying float v_speed;

uniform float u_trailBrightness; // overall brightness, e.g. 1.0

void main() {
    float brightness = u_trailBrightness * (0.6 + v_speed * 0.4);
    gl_FragColor = vec4(v_color * brightness, v_alpha * 0.7);
}
