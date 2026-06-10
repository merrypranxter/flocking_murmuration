// render_boids_point.vert
// Vertex shader — Point sprite rendering for 100k+ boids.
// Draws one point per agent; reads position from GPGPU texture.
// Point size scales with depth (perspective) and agent speed.

precision highp float;

attribute float a_index;       // agent index [0, agentCount)

uniform sampler2D u_positionTex;
uniform sampler2D u_velocityTex;
uniform float     u_agentTexSize;  // e.g. 512 for 512x512 texture
uniform mat4      u_projMat;
uniform mat4      u_viewMat;
uniform float     u_pointSize;     // base point size (pixels), e.g. 3.0
uniform float     u_speedSizeScale; // how much speed inflates the point, e.g. 0.5

varying float v_speed;
varying vec3  v_color;
varying float v_depth;

vec2 indexToUV(float idx) {
    float u = (mod(idx, u_agentTexSize) + 0.5) / u_agentTexSize;
    float v = (floor(idx / u_agentTexSize) + 0.5) / u_agentTexSize;
    return vec2(u, v);
}

void main() {
    vec2 uv = indexToUV(a_index);
    vec4 posData = texture2D(u_positionTex, uv);
    vec4 velData = texture2D(u_velocityTex, uv);

    vec3 pos   = posData.rgb;
    float speed = velData.a; // normalized speed

    v_speed = speed;

    // Depth cue for color (top of flock = lighter)
    v_depth = 0.5 + pos.y * 0.5;

    // View-space position for depth-scaled point size
    vec4 viewPos = u_viewMat * vec4(pos, 1.0);
    float depthFactor = 1.0 / max(-viewPos.z * 0.1, 0.001);

    gl_Position  = u_projMat * viewPos;
    gl_PointSize = (u_pointSize + speed * u_speedSizeScale) * depthFactor;

    // Color: dark slate at back of flock → pale silver at front
    v_color = mix(vec3(0.05, 0.07, 0.12), vec3(0.75, 0.80, 0.90), v_depth);
}
