/**
 * renderer.js
 * Boid Rendering Manager — Three.js
 *
 * Supports three render modes, selected by Renderer.setMode():
 *   'points'    — GL_POINTS with soft disc sprites (100k+ agents, low cost)
 *   'trails'    — GL_LINES motion-blur trails per agent
 *   'volumetric'— density splat + fullscreen post-process (most visual)
 *
 * LOD system (managed by lod.js) determines which mode is used per-agent
 * based on camera distance; renderer.js just receives the current global mode.
 *
 * Blending: additive (src=ONE, dst=ONE) for luminous flock glow effect.
 */

import * as THREE from 'three';

// Import shader sources
import pointVertSrc     from '../shaders/render_boids_point.vert?raw';
import pointFragSrc     from '../shaders/render_boids_point.frag?raw';
import trailVertSrc     from '../shaders/render_motion_trails.vert?raw';
import trailFragSrc     from '../shaders/render_motion_trails.frag?raw';
import volFragSrc       from '../shaders/render_volumetric_cloud.frag?raw';

export class Renderer {
    /**
     * @param {THREE.WebGLRenderer} glRenderer
     * @param {THREE.Scene}         scene
     * @param {THREE.Camera}        camera
     * @param {number}              agentCount
     * @param {number}              texSize      — sqrt of texture dimensions
     */
    constructor(glRenderer, scene, camera, agentCount, texSize) {
        this.glRenderer  = glRenderer;
        this.scene       = scene;
        this.camera      = camera;
        this.agentCount  = agentCount;
        this.texSize     = texSize;
        this.mode        = 'points';

        this._pointsMesh  = null;
        this._trailsMesh  = null;
        this._volumetricQuad = null;

        this._densityRT = new THREE.WebGLRenderTarget(512, 512, {
            format:      THREE.RGBAFormat,
            type:        THREE.FloatType,
            minFilter:   THREE.LinearFilter,
            magFilter:   THREE.LinearFilter,
            depthBuffer: false,
        });

        this._buildPointsMesh();
        this._buildTrailsMesh();
        this._buildVolumetricQuad();
    }

    /** Build instanced GL_POINTS geometry */
    _buildPointsMesh() {
        const indices = new Float32Array(this.agentCount);
        for (let i = 0; i < this.agentCount; i++) indices[i] = i;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('a_index', new THREE.BufferAttribute(indices, 1));
        geo.setDrawRange(0, this.agentCount);

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                u_positionTex:   { value: null },
                u_velocityTex:   { value: null },
                u_agentTexSize:  { value: this.texSize },
                u_projMat:       { value: this.camera.projectionMatrix },
                u_viewMat:       { value: this.camera.matrixWorldInverse },
                u_pointSize:     { value: 3.0 },
                u_speedSizeScale:{ value: 0.5 },
                u_opacity:       { value: 0.85 },
            },
            vertexShader:   pointVertSrc,
            fragmentShader: pointFragSrc,
            blending:       THREE.AdditiveBlending,
            depthWrite:     false,
            transparent:    true,
        });

        this._pointsMesh = new THREE.Points(geo, mat);
        this._pointsMesh.frustumCulled = false;
        this.scene.add(this._pointsMesh);
        this._pointsMesh.visible = true;
    }

    /** Build GL_LINES trail geometry: 2 vertices per agent */
    _buildTrailsMesh() {
        const n = this.agentCount;
        const indices = new Float32Array(n * 2);
        const ends    = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
            indices[i * 2 + 0] = i; ends[i * 2 + 0] = 0.0; // head
            indices[i * 2 + 1] = i; ends[i * 2 + 1] = 1.0; // tail
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('a_index', new THREE.BufferAttribute(indices, 1));
        geo.setAttribute('a_end',   new THREE.BufferAttribute(ends,    1));
        geo.setDrawRange(0, n * 2);

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                u_positionTex:   { value: null },
                u_velocityTex:   { value: null },
                u_agentTexSize:  { value: this.texSize },
                u_projMat:       { value: this.camera.projectionMatrix },
                u_viewMat:       { value: this.camera.matrixWorldInverse },
                u_trailLength:   { value: 0.05 },
                u_trailBrightness: { value: 1.0 },
            },
            vertexShader:   trailVertSrc,
            fragmentShader: trailFragSrc,
            blending:       THREE.AdditiveBlending,
            depthWrite:     false,
            transparent:    true,
        });

        this._trailsMesh = new THREE.LineSegments(geo, mat);
        this._trailsMesh.frustumCulled = false;
        this._trailsMesh.visible = false;
        this.scene.add(this._trailsMesh);
    }

    /** Build fullscreen quad for volumetric post-process */
    _buildVolumetricQuad() {
        const geo = new THREE.PlaneGeometry(2, 2);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                u_densityTex:     { value: this._densityRT.texture },
                u_backgroundTex:  { value: null },
                u_resolution:     { value: new THREE.Vector2(
                    this.glRenderer.domElement.width,
                    this.glRenderer.domElement.height
                )},
                u_time:           { value: 0.0 },
                u_densityScale:   { value: 0.8 },
        u_lightDir:       { value: new THREE.Vector2(1.0, 0.0) },
                u_flockColor:     { value: new THREE.Color(0.5, 0.6, 0.8) },
                u_edgeSharpen:    { value: 1.5 },
            },
            vertexShader: `
                void main() { gl_Position = vec4(position, 1.0); }
            `,
            fragmentShader: volFragSrc,
            depthWrite:     false,
            depthTest:      false,
        });

        this._volumetricQuad = new THREE.Mesh(geo, mat);
        this._volumetricQuad.frustumCulled = false;
        this._volumetricQuad.visible = false;
        this.scene.add(this._volumetricQuad);
    }

    /** Switch active render mode */
    setMode(mode) {
        this.mode = mode;
        this._pointsMesh.visible  = (mode === 'points');
        this._trailsMesh.visible  = (mode === 'trails');
        this._volumetricQuad.visible = (mode === 'volumetric');
    }

    /** Update GPU textures and camera matrices before rendering */
    update(positionTex, velocityTex, time) {
        const viewMat = this.camera.matrixWorldInverse;
        const projMat = this.camera.projectionMatrix;

        // Points
        const pu = this._pointsMesh.material.uniforms;
        pu.u_positionTex.value = positionTex;
        pu.u_velocityTex.value = velocityTex;
        pu.u_viewMat.value     = viewMat;
        pu.u_projMat.value     = projMat;

        // Trails
        const tu = this._trailsMesh.material.uniforms;
        tu.u_positionTex.value = positionTex;
        tu.u_velocityTex.value = velocityTex;
        tu.u_viewMat.value     = viewMat;
        tu.u_projMat.value     = projMat;

        // Volumetric
        if (this.mode === 'volumetric') {
            this._volumetricQuad.material.uniforms.u_time.value = time;
        }
    }

    setParam(param, value) {
        const pu = this._pointsMesh.material.uniforms;
        const tu = this._trailsMesh.material.uniforms;
        if (param in pu) pu[param].value = value;
        if (param in tu) tu[param].value = value;
    }

    dispose() {
        this._pointsMesh.geometry.dispose();
        this._pointsMesh.material.dispose();
        this._trailsMesh.geometry.dispose();
        this._trailsMesh.material.dispose();
        this._volumetricQuad.geometry.dispose();
        this._volumetricQuad.material.dispose();
        this._densityRT.dispose();
    }
}
