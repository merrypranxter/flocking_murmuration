// render_boids_point.frag
// Fragment shader — Soft circular point sprites for boid rendering.
// Paired with render_boids_point.vert.
// Blended with additive blending (src=ONE, dst=ONE) for luminous effect.

precision highp float;

varying float v_speed;
varying vec3  v_color;
varying float v_depth;

uniform float u_opacity; // global opacity, e.g. 0.85

void main() {
    // Point coord: (0,0)=top-left (1,1)=bottom-right
    vec2 pc = gl_PointCoord - 0.5;
    float dist = length(pc) * 2.0; // 0 at center, 1 at edge

    // Soft disc with slight motion-glow at center
    float alpha = smoothstep(1.0, 0.2, dist);
    float glow  = smoothstep(1.0, 0.0, dist * 0.7) * 0.4;

    // Speed-dependent brightness boost
    float brightness = 0.7 + v_speed * 0.3;
    vec3 col = v_color * brightness + glow * vec3(1.0);

    gl_FragColor = vec4(col, alpha * u_opacity);
}
