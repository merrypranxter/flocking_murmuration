// render_mesh_instances.vert
// Vertex shader — Instanced mesh rendering for near-field boids (LOD level 2).
// Renders a simple 2-triangle arrow/bird silhouette at each agent's position,
// oriented along its velocity vector.

precision highp float;

// Per-vertex: the bird silhouette mesh (quad or wing shape, 6 vertices = 2 tris)
attribute vec3 a_vertPos;   // local-space mesh vertex
attribute vec3 a_normal;    // local-space normal

// Per-instance (from index): read from GPGPU textures
attribute float a_index;

uniform sampler2D u_positionTex;
uniform sampler2D u_velocityTex;
uniform float     u_agentTexSize;
uniform mat4      u_projMat;
uniform mat4      u_viewMat;
uniform float     u_birdScale;  // world-space scale, e.g. 0.008

varying vec3  v_normal;
varying float v_speed;
varying vec3  v_color;

vec2 indexToUV(float idx) {
    float u = (mod(idx, u_agentTexSize) + 0.5) / u_agentTexSize;
    float v = (floor(idx / u_agentTexSize) + 0.5) / u_agentTexSize;
    return vec2(u, v);
}

// Build TBN matrix: orient local +Z along velocity
mat3 lookRotation(vec3 forward) {
    vec3 up = vec3(0.0, 1.0, 0.0);
    if (abs(dot(forward, up)) > 0.99) up = vec3(1.0, 0.0, 0.0);
    vec3 right   = normalize(cross(forward, up));
    vec3 trueUp  = cross(right, forward);
    return mat3(right, trueUp, forward);
}

void main() {
    vec2 uv = indexToUV(a_index);
    vec3 pos   = texture2D(u_positionTex, uv).rgb;
    vec4 vel   = texture2D(u_velocityTex, uv);
    float speed = vel.a;

    vec3 forward = length(vel.rgb) > 0.001 ? normalize(vel.rgb) : vec3(0.0, 0.0, 1.0);
    mat3 rot = lookRotation(forward);

    // Transform mesh vertex to world space
    vec3 worldPos = pos + rot * (a_vertPos * u_birdScale);
    v_normal = normalize(rot * a_normal);
    v_speed  = speed;

    float depth = 0.5 + pos.y * 0.5;
    v_color = mix(vec3(0.05, 0.07, 0.12), vec3(0.80, 0.85, 0.95), depth);

    gl_Position = u_projMat * u_viewMat * vec4(worldPos, 1.0);
}
