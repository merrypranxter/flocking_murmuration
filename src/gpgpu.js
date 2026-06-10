/**
 * gpgpu.js
 * GPGPU Ping-Pong FBO Manager for Three.js
 *
 * Manages pairs of WebGLRenderTargets for read/write GPGPU simulation.
 * Each "variable" (position, velocity, etc.) is backed by two render targets;
 * each frame we read from one and write to the other, then swap.
 *
 * Usage:
 *   const gpgpu = new GPGPU(renderer, width, height);
 *   const posVar = gpgpu.addVariable('position', posShader, initData);
 *   const velVar = gpgpu.addVariable('velocity', velShader, initData);
 *   gpgpu.setVariableDependencies(posVar, [posVar, velVar]);
 *   gpgpu.setVariableDependencies(velVar, [posVar, velVar]);
 *   gpgpu.init();
 *
 *   // Each frame:
 *   gpgpu.compute();
 *   renderer.material.uniforms.u_positionTex.value = gpgpu.getCurrentRenderTarget(posVar).texture;
 */

import * as THREE from 'three';

export class GPGPU {
    constructor(renderer, width, height) {
        this.renderer = renderer;
        this.width    = width;
        this.height   = height;
        this.variables = [];
        this._passThruUniforms = null;
        this._passThruMaterial = null;
        this._mesh = null;
        this._scene = new THREE.Scene();
        this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }

    /** Create an RGBA float render target pair */
    _createRenderTarget() {
        return new THREE.WebGLRenderTarget(this.width, this.height, {
            wrapS:          THREE.ClampToEdgeWrapping,
            wrapT:          THREE.ClampToEdgeWrapping,
            minFilter:      THREE.NearestFilter,
            magFilter:      THREE.NearestFilter,
            format:         THREE.RGBAFormat,
            type:           THREE.FloatType,
            depthBuffer:    false,
            stencilBuffer:  false,
        });
    }

    /**
     * Add a simulation variable.
     * @param {string}          name        — uniform name in dependent shaders
     * @param {string}          fragShader  — GLSL fragment shader source
     * @param {Float32Array}    initData    — initial pixel data (w*h*4 floats)
     * @returns variable object
     */
    addVariable(name, fragShader, initData) {
        const rtA = this._createRenderTarget();
        const rtB = this._createRenderTarget();

        // Upload initial data
        if (initData) {
            const tex = new THREE.DataTexture(
                initData, this.width, this.height,
                THREE.RGBAFormat, THREE.FloatType
            );
            tex.needsUpdate = true;
            this._fillRenderTarget(rtA, tex);
            this._fillRenderTarget(rtB, tex);
        }

        const material = new THREE.ShaderMaterial({
            uniforms:       { ...THREE.UniformsUtils.clone({}) },
            vertexShader:   this._passThroughVertexShader(),
            fragmentShader: fragShader,
        });

        const variable = { name, material, renderTargets: [rtA, rtB], current: 0, dependencies: [] };
        this.variables.push(variable);
        return variable;
    }

    /** Declare which variables a shader reads (sets sampler uniforms). */
    setVariableDependencies(variable, dependencies) {
        variable.dependencies = dependencies;
    }

    /** Call after all variables added; sets up dependency uniforms. */
    init() {
        if (!this._mesh) {
            const geo = new THREE.PlaneGeometry(2, 2);
            this._mesh = new THREE.Mesh(geo, null);
            this._scene.add(this._mesh);
        }

        for (const v of this.variables) {
            for (const dep of v.dependencies) {
                v.material.uniforms[dep.name] = {
                    value: this._readRT(dep).texture
                };
            }
        }
    }

    /** Run one compute step: update all variables in declared order. */
    compute() {
        const autoClear = this.renderer.autoClear;
        this.renderer.autoClear = false;

        for (const v of this.variables) {
            // Update dependency texture pointers to current (readable) targets
            for (const dep of v.dependencies) {
                v.material.uniforms[dep.name].value = this._readRT(dep).texture;
            }
            this._mesh.material = v.material;
            this.renderer.setRenderTarget(this._writeRT(v));
            this.renderer.render(this._scene, this._camera);
            v.current ^= 1; // swap
        }

        this.renderer.setRenderTarget(null);
        this.renderer.autoClear = autoClear;
    }

    /** Get the current readable render target for a variable. */
    getCurrentRenderTarget(variable) {
        return this._readRT(variable);
    }

    /** Set a uniform on a variable's material. */
    setUniform(variable, name, value) {
        if (!variable.material.uniforms[name]) {
            variable.material.uniforms[name] = { value };
        } else {
            variable.material.uniforms[name].value = value;
        }
    }

    _readRT(v)  { return v.renderTargets[v.current]; }
    _writeRT(v) { return v.renderTargets[v.current ^ 1]; }

    _fillRenderTarget(rt, texture) {
        if (!this._passThruMaterial) {
            this._passThruUniforms = { u_tex: { value: null } };
            this._passThruMaterial = new THREE.ShaderMaterial({
                uniforms:       this._passThruUniforms,
                vertexShader:   this._passThroughVertexShader(),
                fragmentShader: `
                    precision highp float;
                    uniform sampler2D u_tex;
                    varying vec2 v_uv;
                    void main() { gl_FragColor = texture2D(u_tex, v_uv); }
                `,
            });
        }
        this._passThruUniforms.u_tex.value = texture;
        const autoClear = this.renderer.autoClear;
        this.renderer.autoClear = false;
        if (!this._mesh) {
            const geo = new THREE.PlaneGeometry(2, 2);
            this._mesh = new THREE.Mesh(geo, null);
        }
        this._mesh.material = this._passThruMaterial;
        this.renderer.setRenderTarget(rt);
        this.renderer.render(this._scene, this._camera);
        this.renderer.setRenderTarget(null);
        this.renderer.autoClear = autoClear;
    }

    _passThroughVertexShader() {
        return `
            varying vec2 v_uv;
            void main() {
                v_uv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `;
    }

    dispose() {
        for (const v of this.variables) {
            v.renderTargets[0].dispose();
            v.renderTargets[1].dispose();
            v.material.dispose();
        }
        if (this._mesh) this._mesh.geometry.dispose();
    }
}
