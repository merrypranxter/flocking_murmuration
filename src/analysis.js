/**
 * analysis.js
 * Real-time flock analysis tools.
 *
 * Runs GPU-based analysis passes to measure:
 *   - Vicsek order parameter φ (degree of alignment, 0=disordered, 1=aligned)
 *   - Shannon entropy of velocity direction distribution (per spatial cell)
 *   - Velocity autocorrelation C(r) (detects scale-free correlations)
 *   - Cluster count estimate (via density threshold on the hash grid)
 *
 * Results are available as:
 *   analysis.orderParameter  — float [0,1]
 *   analysis.entropy         — float [0,1] (normalised)
 *   analysis.correlationData — Float32Array (1D C(r) histogram, 128 bins)
 */

import * as THREE from 'three';
import orderParamFragSrc from '../shaders/analysis_order_parameter.frag?raw';
import entropyFragSrc    from '../shaders/analysis_entropy.frag?raw';
import correlFragSrc     from '../shaders/analysis_velocity_correlation.frag?raw';

const PASS_VERT = `
    void main() { gl_Position = vec4(position, 1.0); }
`;

export class Analysis {
    constructor(renderer, texSize) {
        this.renderer  = renderer;
        this.texSize   = texSize;

        this.orderParameter  = 0;
        this.entropy         = 0;
        this.correlationData = new Float32Array(128 * 4);

        // Order parameter: hierarchical reduction
        // Start at texSize/4 x texSize/4, reduce by 4x each pass until 1x1
        this._orderRT = new THREE.WebGLRenderTarget(1, 1, {
            format:      THREE.RGBAFormat,
            type:        THREE.FloatType,
            minFilter:   THREE.NearestFilter,
            magFilter:   THREE.NearestFilter,
            depthBuffer: false,
        });

        // Entropy map: same resolution as agents
        this._entropyRT = new THREE.WebGLRenderTarget(texSize, texSize, {
            format:      THREE.RGBAFormat,
            type:        THREE.FloatType,
            minFilter:   THREE.NearestFilter,
            magFilter:   THREE.NearestFilter,
            depthBuffer: false,
        });

        // Correlation histogram: 128x1 pixels
        this._correlRT = new THREE.WebGLRenderTarget(128, 1, {
            format:      THREE.RGBAFormat,
            type:        THREE.FloatType,
            minFilter:   THREE.NearestFilter,
            magFilter:   THREE.NearestFilter,
            depthBuffer: false,
        });

        this._scene  = new THREE.Scene();
        this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const geo    = new THREE.PlaneGeometry(2, 2);

        // Order parameter material (single-pass reduction at 1x1)
        this._orderMat = new THREE.ShaderMaterial({
            uniforms: {
                u_velocityTex:      { value: null },
                u_agentTexSize:     { value: texSize },
                u_reduceBlockSize:  { value: texSize }, // reduce entire texture at once
            },
            vertexShader:   PASS_VERT,
            fragmentShader: orderParamFragSrc,
            depthWrite:     false,
            depthTest:      false,
        });

        // Entropy material
        this._entropyMat = new THREE.ShaderMaterial({
            uniforms: {
                u_velocityTex:   { value: null },
                u_agentTexSize:  { value: texSize },
                u_cellSize:      { value: 4.0 },
                u_numAngleBins:  { value: 16.0 },
            },
            vertexShader:   PASS_VERT,
            fragmentShader: entropyFragSrc,
            depthWrite:     false,
            depthTest:      false,
        });

        // Correlation material
        this._correlMat = new THREE.ShaderMaterial({
            uniforms: {
                u_positionTex:    { value: null },
                u_velocityTex:    { value: null },
                u_agentTexSize:   { value: texSize },
                u_maxCorrelDist:  { value: 1.0 },
                u_numBins:        { value: 128.0 },
                u_sampleSeed:     { value: 0.0 },
            },
            vertexShader:   PASS_VERT,
            fragmentShader: correlFragSrc,
            depthWrite:     false,
            depthTest:      false,
        });

        this._orderMesh  = new THREE.Mesh(geo, this._orderMat);
        this._entropyMesh = new THREE.Mesh(geo, this._entropyMat);
        this._correlMesh  = new THREE.Mesh(geo, this._correlMat);
    }

    /**
     * Run one analysis frame.
     * @param {THREE.Texture} velTex — current velocity render target texture
     * @param {THREE.Texture} [posTex] — optional, needed for correlation
     */
    compute(velTex, posTex, time = 0) {
        const autoClear = this.renderer.autoClear;
        this.renderer.autoClear = true;

        // --- Order parameter ---
        this._orderMat.uniforms.u_velocityTex.value = velTex;
        this._scene.add(this._orderMesh);
        this.renderer.setRenderTarget(this._orderRT);
        this.renderer.render(this._scene, this._camera);
        this._scene.remove(this._orderMesh);

        // Read back 1x1 result
        const orderBuf = new Float32Array(4);
        this.renderer.readRenderTargetPixels(this._orderRT, 0, 0, 1, 1, orderBuf);
        const vxSum = orderBuf[0];
        const vySum = orderBuf[1];
        const vzSum = orderBuf[2];
        const count = Math.max(1, orderBuf[3]);
        this.orderParameter = Math.sqrt(vxSum*vxSum + vySum*vySum + vzSum*vzSum) / count;

        // --- Entropy (optional, costly — skip if no posTex) ---
        this._entropyMat.uniforms.u_velocityTex.value = velTex;
        this._scene.add(this._entropyMesh);
        this.renderer.setRenderTarget(this._entropyRT);
        this.renderer.render(this._scene, this._camera);
        this._scene.remove(this._entropyMesh);

        // Read back a sample entropy value (centre of texture)
        const entropyBuf = new Float32Array(4);
        this.renderer.readRenderTargetPixels(this._entropyRT,
            Math.floor(this._entropyRT.width / 2),
            Math.floor(this._entropyRT.height / 2),
            1, 1, entropyBuf);
        this.entropy = entropyBuf[0]; // normalised [0,1]

        // --- Velocity correlation (slow, only if position tex provided) ---
        if (posTex) {
            this._correlMat.uniforms.u_positionTex.value = posTex;
            this._correlMat.uniforms.u_velocityTex.value = velTex;
            this._correlMat.uniforms.u_sampleSeed.value  = (time * 17.3) % 1000.0;
            this._scene.add(this._correlMesh);
            this.renderer.setRenderTarget(this._correlRT);
            this.renderer.render(this._scene, this._camera);
            this._scene.remove(this._correlMesh);
            this.renderer.readRenderTargetPixels(
                this._correlRT, 0, 0, 128, 1, this.correlationData
            );
        }

        this.renderer.setRenderTarget(null);
        this.renderer.autoClear = autoClear;
    }

    dispose() {
        this._orderRT.dispose();
        this._entropyRT.dispose();
        this._correlRT.dispose();
        this._orderMat.dispose();
        this._entropyMat.dispose();
        this._correlMat.dispose();
    }
}
