// analysis_entropy.frag
// GPGPU shader — Shannon entropy of velocity direction distribution.
// Discretizes velocity directions into angular bins and computes H = -Σ p log p.
// High entropy → disordered flock; low entropy → aligned, ordered flock.
//
// This is a per-cell entropy map: each output texel covers a spatial region
// and computes the local entropy of agents within it, useful for visualizing
// ordered vs. disordered sub-regions in real time.

precision highp float;

uniform sampler2D u_velocityTex;
uniform float     u_agentTexSize;
uniform float     u_cellSize;       // spatial cell size in agent-tex coordinates
uniform float     u_numAngleBins;   // e.g. 16 — angular resolution

// Encode angle bin index
float angleBin(vec3 vel, float numBins) {
    float azimuth = atan(vel.z, vel.x); // [-π, π]
    float norm = (azimuth + 3.14159) / 6.28318; // [0, 1]
    return floor(norm * numBins);
}

void main() {
    vec2 cellUV = gl_FragCoord.xy / u_agentTexSize;

    // Count agents in this cell into angular bins
    float bins[16]; // GLSL ES 2.0: must use fixed array
    // Note: GLSL ES 2.0 doesn't support dynamic array indexing in all impls.
    // We use a workaround: unrolled 16-bin accumulation.
    float b0=0.,b1=0.,b2=0.,b3=0.,b4=0.,b5=0.,b6=0.,b7=0.;
    float b8=0.,b9=0.,b10=0.,b11=0.,b12=0.,b13=0.,b14=0.,b15=0.;
    float total = 0.0;

    float half = u_cellSize * 0.5;
    for (float dy = -half; dy <= half; dy++) {
    for (float dx = -half; dx <= half; dx++) {
        vec2 sampleUV = (gl_FragCoord.xy + vec2(dx, dy)) / u_agentTexSize;
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) continue;
        vec3 vel = texture2D(u_velocityTex, sampleUV).rgb;
        if (length(vel) < 0.001) continue;
        float bin = angleBin(vel, 16.0);
        // Unrolled bin accumulation
        if (bin < 1.0)       b0++;
        else if (bin < 2.0)  b1++;
        else if (bin < 3.0)  b2++;
        else if (bin < 4.0)  b3++;
        else if (bin < 5.0)  b4++;
        else if (bin < 6.0)  b5++;
        else if (bin < 7.0)  b6++;
        else if (bin < 8.0)  b7++;
        else if (bin < 9.0)  b8++;
        else if (bin < 10.0) b9++;
        else if (bin < 11.0) b10++;
        else if (bin < 12.0) b11++;
        else if (bin < 13.0) b12++;
        else if (bin < 14.0) b13++;
        else if (bin < 15.0) b14++;
        else                 b15++;
        total++;
    }}

    if (total < 1.0) { gl_FragColor = vec4(0.0); return; }

    // Compute Shannon entropy H = -Σ (p * log2(p))
    float H = 0.0;
    float binArr[16];
    binArr[0]=b0; binArr[1]=b1; binArr[2]=b2;  binArr[3]=b3;
    binArr[4]=b4; binArr[5]=b5; binArr[6]=b6;  binArr[7]=b7;
    binArr[8]=b8; binArr[9]=b9; binArr[10]=b10; binArr[11]=b11;
    binArr[12]=b12; binArr[13]=b13; binArr[14]=b14; binArr[15]=b15;
    for (int i = 0; i < 16; i++) {
        float p = binArr[i] / total;
        if (p > 0.0001) H -= p * log2(p);
    }
    // Normalize by max entropy (log2(numBins))
    float Hnorm = H / log2(16.0);

    gl_FragColor = vec4(Hnorm, H, total, 1.0);
}
