// render_motion_trails.vert
// Vertex shader — Motion blur trails for boid visualization.
// Each agent is rendered as a short line segment (2 vertices):
//   vertex 0 = current position
//   vertex 1 = current position - velocity * trailLength
// The line fades from opaque at the head to transparent at the tail.

precision highp float;

attribute float a_index;      // agent index [0, agentCount)
attribute float a_end;        // 0.0 = head, 1.0 = tail

uniform sampler2D u_positionTex;
uniform sampler2D u_velocityTex;
uniform float     u_agentTexSize;
uniform mat4      u_projMat;
uniform mat4      u_viewMat;
uniform float     u_trailLength; // world units, e.g. 0.05

varying float v_alpha;
varying vec3  v_color;
varying float v_speed;

vec2 indexToUV(float idx) {
    float u = (mod(idx, u_agentTexSize) + 0.5) / u_agentTexSize;
    float v = (floor(idx / u_agentTexSize) + 0.5) / u_agentTexSize;
    return vec2(u, v);
}

void main() {
    vec2 uv = indexToUV(a_index);
    vec3 pos = texture2D(u_positionTex, uv).rgb;
    vec4 vel = texture2D(u_velocityTex, uv);
    float speed = vel.a;

    // Trail endpoint is behind the agent in its direction of travel
    float trailScale = u_trailLength * (0.5 + speed * 0.5);
    vec3 tailPos = pos - normalize(vel.rgb) * trailScale;

    // Mix between head and tail positions
    vec3 worldPos = mix(pos, tailPos, a_end);

    v_alpha = 1.0 - a_end; // head opaque, tail transparent
    v_speed = speed;

    float depth = 0.5 + pos.y * 0.5;
    v_color = mix(vec3(0.08, 0.10, 0.18), vec3(0.70, 0.78, 0.92), depth);

    gl_Position = u_projMat * u_viewMat * vec4(worldPos, 1.0);
}
