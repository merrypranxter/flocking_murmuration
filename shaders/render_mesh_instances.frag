// render_mesh_instances.frag
// Fragment shader — Lit mesh instances for near-field boids.

precision highp float;

varying vec3  v_normal;
varying float v_speed;
varying vec3  v_color;

uniform vec3  u_lightDir;   // normalized world-space light direction
uniform float u_ambientStr; // 0.3

void main() {
    vec3 N = normalize(v_normal);
    vec3 L = normalize(u_lightDir);

    float diffuse = max(0.0, dot(N, L));
    float ambient = u_ambientStr;
    float lighting = ambient + (1.0 - ambient) * diffuse;

    // Speed-based highlight
    float highlight = v_speed * 0.2;
    vec3 color = v_color * lighting + highlight * vec3(0.6, 0.7, 0.8);

    gl_FragColor = vec4(color, 1.0);
}
