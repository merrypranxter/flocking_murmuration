// render_volumetric_cloud.frag
// Full-screen post-process shader — Volumetric density cloud rendering.
// Operates on a density texture that accumulates point-splatted agent positions,
// then applies raymarching-style depth integration to produce a cloud-like volume.
//
// Pass 1: splat agent positions into a low-res density texture (done CPU-side
//         by rendering GL_POINTS at agent positions with an additive splatting frag).
// Pass 2 (THIS SHADER): read density texture, apply volumetric color mapping,
//         edge-detect density gradients for normal estimation, add fake lighting.
//
// Uniform u_densityTex: RGBA32F density accumulation buffer

precision highp float;

uniform sampler2D u_densityTex;  // density accumulation (previous pass)
uniform sampler2D u_backgroundTex; // scene background (sky)
uniform vec2      u_resolution;
uniform float     u_time;
uniform float     u_densityScale; // 0.8 — maps raw density to [0,1]
uniform float     u_lightDir;     // angle of "sun" in sky (radians)
uniform vec3      u_flockColor;   // base color of flock cloud
uniform float     u_edgeSharpen; // 1.5 — edge enhancement factor

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    float density = texture2D(u_densityTex, uv).r * u_densityScale;
    density = clamp(density, 0.0, 1.0);

    // Gradient (fake normal from density gradient)
    vec2 texel = 1.0 / u_resolution;
    float dx = texture2D(u_densityTex, uv + vec2(texel.x, 0.0)).r
             - texture2D(u_densityTex, uv - vec2(texel.x, 0.0)).r;
    float dy = texture2D(u_densityTex, uv + vec2(0.0, texel.y)).r
             - texture2D(u_densityTex, uv - vec2(0.0, texel.y)).r;
    vec2 grad = vec2(dx, dy) * u_densityScale;
    float edgeMag = length(grad) * u_edgeSharpen;

    // Light direction (simplified 2D)
    vec2 lightDir = vec2(cos(u_lightDir), sin(u_lightDir));
    float diffuse = max(0.0, dot(normalize(grad + vec2(0.001)), lightDir));

    // Background sky
    vec3 bg = texture2D(u_backgroundTex, uv).rgb;

    // Flock volume color: dark in depth (dense), lighter at edges
    vec3 shallowColor = u_flockColor * 1.5;
    vec3 deepColor    = u_flockColor * 0.3;
    vec3 cloudColor   = mix(shallowColor, deepColor, density);
    cloudColor += diffuse * vec3(0.3, 0.3, 0.25) * density;  // fake lighting
    cloudColor += edgeMag * vec3(0.5, 0.55, 0.6) * (1.0 - density); // edge glow

    // Composite over background
    float alpha = smoothstep(0.0, 0.15, density);
    vec3 color = mix(bg, cloudColor, alpha);

    // Subtle atmospheric haze
    float haze = 1.0 - length(uv - 0.5) * 0.3;
    color *= haze;

    gl_FragColor = vec4(color, 1.0);
}
