// analysis_order_parameter.frag
// GPGPU reduce shader — Vicsek order parameter φ = |⟨v̂⟩| ∈ [0,1].
// φ=0 → completely disordered; φ=1 → all agents moving in same direction.
//
// This is a two-pass reduction:
//   Pass 1: Sum velocity directions into a lower-res texture (hierarchical sum)
//   Pass 2 (THIS): read the halved texture, sum again until 1x1 result
//
// The CPU reads the final 1x1 texel to get the order parameter.
// Also outputs local order (per 4x4 block) for spatial visualization.
//
// Theory: Vicsek et al. 1995 define the order parameter as the normalized
// magnitude of the mean velocity, analogous to magnetization in spin systems.

precision highp float;

uniform sampler2D u_velocityTex;
uniform float     u_agentTexSize;
uniform float     u_reduceBlockSize; // pixels to reduce per output texel (e.g. 4)

void main() {
    // Each output texel accumulates u_reduceBlockSize x u_reduceBlockSize input texels
    vec2 outUV = gl_FragCoord.xy;
    float blockSize = u_reduceBlockSize;

    vec3 velSum = vec3(0.0);
    float count = 0.0;

    // Iterate over input block
    for (float dy = 0.0; dy < 16.0; dy++) {
    for (float dx = 0.0; dx < 16.0; dx++) {
        if (dx >= blockSize || dy >= blockSize) break;
        vec2 inTexel = (outUV - 0.5) * blockSize + vec2(dx, dy) + 0.5;
        vec2 inUV = inTexel / u_agentTexSize;
        if (inUV.x > 1.0 || inUV.y > 1.0) continue;
        vec3 vel = texture2D(u_velocityTex, inUV).rgb;
        float speed = length(vel);
        if (speed > 0.001) {
            velSum += vel / speed; // direction only
            count++;
        }
    }}

    // Output: RGB = sum of unit velocity vectors, A = count
    gl_FragColor = vec4(velSum, count);
}
