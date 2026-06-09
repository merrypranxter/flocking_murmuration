/**
 * simulation.js
 * Main GPGPU Boid Simulation Orchestrator
 *
 * Wires together:
 *   - GPGPU ping-pong FBO management (gpgpu.js)
 *   - CPU-side spatial hash (spatial_hash.js)
 *   - Per-species shader selection and uniform injection
 *   - Predator agent update loop
 *   - Analysis pass scheduling (every N frames)
 *
 * Supported species: starling, sardine, gnat, bat, firefly, moth, locust, jellyfish
 * Supported predators: hawk, peregrine, chaotic, wave, obstacle, food
 */

import * as THREE from 'three';
import { GPGPU } from './gpgpu.js';
import { SpatialHash } from './spatial_hash.js';
import { Analysis } from './analysis.js';

// Import all species shaders (bundled as raw strings by your build tool)
import updateStarlingFrag   from '../shaders/update_starling_boids.frag?raw';
import updateSardineFrag    from '../shaders/update_sardine_boids.frag?raw';
import updateGnatFrag       from '../shaders/update_gnat_cloud.frag?raw';
import updateBatFrag        from '../shaders/update_bat_emergence.frag?raw';
import updateFireflyFrag    from '../shaders/update_firefly_dance.frag?raw';
import updateMothFrag       from '../shaders/update_moth_swarm.frag?raw';
import updateLocustFrag     from '../shaders/update_locust_plague.frag?raw';
import updateJellyfishFrag  from '../shaders/update_jellyfish_pulse.frag?raw';

const SPECIES_SHADERS = {
    starling:  updateStarlingFrag,
    sardine:   updateSardineFrag,
    gnat:      updateGnatFrag,
    bat:       updateBatFrag,
    firefly:   updateFireflyFrag,
    moth:      updateMothFrag,
    locust:    updateLocustFrag,
    jellyfish: updateJellyfishFrag,
};

export class Simulation {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {object} config — loaded from agents/agents_[species]_[n].json
     */
    constructor(renderer, config) {
        this.renderer = renderer;
        this.config   = config;
        this.species  = config.species;
        this.agentCount = config.agentCount;

        // Texture dimensions: smallest power-of-two square ≥ agentCount
        this.texSize = Math.pow(2, Math.ceil(Math.log2(Math.sqrt(this.agentCount))));

        this.gpgpu  = new GPGPU(renderer, this.texSize, this.texSize);
        this.hash   = new SpatialHash(this.agentCount);
        this.analysis = new Analysis(renderer, this.texSize);

        this._time        = 0;
        this._frameCount  = 0;
        this._predatorPos = new THREE.Vector3(0, 0.5, 0);
        this._predatorActive = false;
        this._analysisInterval = 10; // run analysis every N frames

        this._posVar = null;
        this._velVar = null;

        // Hash textures (updated each frame)
        this._hashTex = null;
        this._cellsTex = null;

        this._initTextures();
        this._initGPGPU();
    }

    /** Generate initial random positions and velocities */
    _initTextures() {
        const n = this.texSize * this.texSize;
        const posData = new Float32Array(n * 4);
        const velData = new Float32Array(n * 4);
        const cfg = this.config;

        for (let i = 0; i < this.agentCount; i++) {
            // Random position inside a sphere of radius 0.5
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const r     = Math.cbrt(Math.random()) * 0.5;
            posData[i * 4 + 0] = r * Math.sin(phi) * Math.cos(theta);
            posData[i * 4 + 1] = r * Math.sin(phi) * Math.sin(theta);
            posData[i * 4 + 2] = r * Math.cos(phi);
            posData[i * 4 + 3] = i / this.agentCount; // normalised ID

            // Random velocity at minSpeed
            const vx = (Math.random() - 0.5);
            const vy = (Math.random() - 0.5);
            const vz = (Math.random() - 0.5);
            const len = Math.sqrt(vx*vx + vy*vy + vz*vz) || 1;
            const spd = cfg.minSpeed || 0.15;
            velData[i * 4 + 0] = (vx / len) * spd;
            velData[i * 4 + 1] = (vy / len) * spd;
            velData[i * 4 + 2] = (vz / len) * spd;
            velData[i * 4 + 3] = Math.random(); // phase / state
        }

        this._initPosData = posData;
        this._initVelData = velData;

        // Hash textures — updated every frame
        const hashTexSize = this.texSize;
        const totalCells  = 64 * 64 * 64;
        const cellTexSize = Math.ceil(Math.sqrt(totalCells));

        this._hashTex = new THREE.DataTexture(
            this.hash.hashData, hashTexSize, hashTexSize,
            THREE.RGBAFormat, THREE.FloatType
        );
        this._cellsTex = new THREE.DataTexture(
            this.hash.cellData, cellTexSize, cellTexSize,
            THREE.RGBAFormat, THREE.FloatType
        );
        this._hashTex.needsUpdate  = true;
        this._cellsTex.needsUpdate = true;
        this._hashTexSize  = hashTexSize;
        this._cellTexSize  = cellTexSize;
    }

    _initGPGPU() {
        const fragSrc = SPECIES_SHADERS[this.species];
        if (!fragSrc) throw new Error(`Unknown species: ${this.species}`);

        this._posVar = this.gpgpu.addVariable('u_positionTex', fragSrc, this._initPosData);
        this._velVar = this.gpgpu.addVariable('u_velocityTex', fragSrc, this._initVelData);

        // Both variables need to read each other
        this.gpgpu.setVariableDependencies(this._posVar, [this._posVar, this._velVar]);
        this.gpgpu.setVariableDependencies(this._velVar, [this._posVar, this._velVar]);

        this.gpgpu.init();
        this._injectConfigUniforms();
    }

    /** Push all config values into both variable shaders */
    _injectConfigUniforms() {
        const c = this.config;
        const vars = [this._posVar, this._velVar];
        const u = (name, val) => vars.forEach(v => this.gpgpu.setUniform(v, name, val));

        u('u_agentTexSize',     this.texSize);
        u('u_dt',               1 / 60);
        u('u_separationRadius', c.separationRadius);
        u('u_alignRadius',      c.alignRadius);
        u('u_cohesionRadius',   c.cohesionRadius);
        u('u_separationWeight', c.separationWeight);
        u('u_alignWeight',      c.alignWeight);
        u('u_cohesionWeight',   c.cohesionWeight);
        u('u_maxSpeed',         c.maxSpeed);
        u('u_minSpeed',         c.minSpeed);
        u('u_maxForce',         c.maxForce);
        u('u_boundaryRadius',   c.boundaryRadius || 0.90);
        u('u_boundaryWeight',   c.boundaryWeight || 3.0);
        u('u_predatorWeight',   c.predatorWeight || 4.0);
        u('u_predatorRadius',   c.predatorRadius || 0.25);
        u('u_hashTex',          this._hashTex);
        u('u_cellsTex',         this._cellsTex);
        u('u_hashTexSize',      this._hashTexSize);

        // Species-specific uniforms
        if (c.speciesUniforms) {
            for (const [name, val] of Object.entries(c.speciesUniforms)) {
                u(name, val);
            }
        }
    }

    /** Set predator position and active state */
    setPredator(pos, active) {
        this._predatorPos.copy(pos);
        this._predatorActive = active;
        const vars = [this._posVar, this._velVar];
        vars.forEach(v => {
            this.gpgpu.setUniform(v, 'u_predatorPos',    pos);
            this.gpgpu.setUniform(v, 'u_predatorActive', active ? 1.0 : 0.0);
        });
    }

    /** Set any uniform on all variables */
    setUniform(name, value) {
        [this._posVar, this._velVar].forEach(v =>
            this.gpgpu.setUniform(v, name, value)
        );
    }

    /** Advance simulation by dt (seconds) */
    update(dt) {
        this._time       += dt;
        this._frameCount++;

        // Update time uniform
        this.setUniform('u_time', this._time);
        this.setUniform('u_dt',   dt);

        // Rebuild spatial hash from previous-frame positions
        // (async readback would be better; synchronous readback for correctness)
        this._rebuildSpatialHash();

        // GPGPU compute step
        this.gpgpu.compute();

        // Analysis pass (throttled)
        if (this._frameCount % this._analysisInterval === 0) {
            this.analysis.compute(this.getVelocityTexture());
        }
    }

    _rebuildSpatialHash() {
        const rt = this.gpgpu.getCurrentRenderTarget(this._posVar);
        const n  = this.texSize * this.texSize;
        const buf = new Float32Array(n * 4);
        this.renderer.readRenderTargetPixels(rt, 0, 0, this.texSize, this.texSize, buf);
        this.hash.build(buf);
        this._hashTex.needsUpdate  = true;
        this._cellsTex.needsUpdate = true;
    }

    getPositionTexture() { return this.gpgpu.getCurrentRenderTarget(this._posVar).texture; }
    getVelocityTexture() { return this.gpgpu.getCurrentRenderTarget(this._velVar).texture; }
    getOrderParameter()  { return this.analysis.orderParameter; }
    getEntropy()         { return this.analysis.entropy; }

    dispose() {
        this.gpgpu.dispose();
        this.analysis.dispose();
        this._hashTex.dispose();
        this._cellsTex.dispose();
    }
}
