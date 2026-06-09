// analysis_velocity_correlation.frag
// GPGPU shader — Velocity correlation C(r) = ⟨v̂_i · v̂_j⟩ as function of r.
// Used to detect scale-free correlations: in critical flocks, C(r) has no
// characteristic length — the correlation length ξ scales with flock size N.
//
// Output: 1D histogram texture where texel x encodes C at distance x/texWidth.
// This pass performs a partial sum over all pairs at a given distance bin.
// Due to GPU cost, only a sample of N_SAMPLE agent pairs is evaluated.
//
// Reference: Cavagna et al. 2010 (PNAS), Eq. (1)-(3).

precision highp float;

uniform sampler2D u_positionTex;
uniform sampler2D u_velocityTex;
uniform float     u_agentTexSize;
uniform float     u_maxCorrelDist;  // world-space maximum distance for binning
uniform float     u_numBins;        // width of output texture (e.g. 128)
uniform float     u_sampleSeed;     // randomized each frame for Monte Carlo sampling

float rand(vec2 co) {
    return fract(sin(dot(co, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 idxToUV(float idx) {
    float u = (mod(idx, u_agentTexSize) + 0.5) / u_agentTexSize;
    float v = (floor(idx / u_agentTexSize) + 0.5) / u_agentTexSize;
    return vec2(u, v);
}

void main() {
    // This texel corresponds to distance bin b
    float b = (gl_FragCoord.x - 0.5) / u_numBins; // [0,1]
    float binMin = b * u_maxCorrelDist;
    float binMax = (b + 1.0 / u_numBins) * u_maxCorrelDist;

    float corrSum = 0.0;
    float pairCount = 0.0;
    float totalAgents = u_agentTexSize * u_agentTexSize;

    // Monte Carlo: sample N_PAIRS random agent pairs
    float N_PAIRS = 256.0;
    for (float k = 0.0; k < N_PAIRS; k++) {
        float iIdx = floor(rand(vec2(k, u_sampleSeed)) * totalAgents);
        float jIdx = floor(rand(vec2(k + 0.5, u_sampleSeed + 1.0)) * totalAgents);
        if (abs(iIdx - jIdx) < 0.5) continue;

        vec2 uvI = idxToUV(iIdx);
        vec2 uvJ = idxToUV(jIdx);

        vec3 posI = texture2D(u_positionTex, uvI).rgb;
        vec3 posJ = texture2D(u_positionTex, uvJ).rgb;
        float dist = length(posI - posJ);

        if (dist < binMin || dist >= binMax) continue;

        vec3 velI = texture2D(u_velocityTex, uvI).rgb;
        vec3 velJ = texture2D(u_velocityTex, uvJ).rgb;
        float sI = length(velI); float sJ = length(velJ);
        if (sI < 0.001 || sJ < 0.001) continue;

        corrSum += dot(velI / sI, velJ / sJ);
        pairCount++;
    }

    float corr = pairCount > 0.0 ? corrSum / pairCount : 0.0;
    gl_FragColor = vec4(corr, pairCount, binMin, binMax);
}
