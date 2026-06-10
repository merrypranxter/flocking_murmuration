/**
 * main.js
 * Entry point — flocking_murmuration
 *
 * Bootstraps the Three.js renderer, camera, simulation loop, and GUI.
 * Loads species config from agents/ directory based on URL hash or GUI selection.
 *
 * URL: index.html#starling   → loads agents/agents_starling_100k.json
 *      index.html#sardine    → loads agents/agents_sardine_200k.json
 *      (etc.)
 *
 * Defaults to starling if no hash is present.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Simulation } from './simulation.js';
import { Renderer   } from './renderer.js';
import { LOD        } from './lod.js';
import { createGUI, drawAnalysisHUD } from './gui.js';

// --- Scene setup ---
const canvas  = document.getElementById('canvas');
const overlay = document.getElementById('hud');
const ctx     = overlay.getContext('2d');

const glRenderer = new THREE.WebGLRenderer({ canvas, antialias: false });
glRenderer.setPixelRatio(window.devicePixelRatio);
glRenderer.setSize(window.innerWidth, window.innerHeight);
glRenderer.setClearColor(0x020306, 1);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001, 100);
camera.position.set(0, 0.3, 2.5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0);
controls.maxDistance = 8;
controls.minDistance = 0.1;

// Add subtle ambient star-field background
const starCount = 2000;
const starGeo   = new THREE.BufferGeometry();
const starPos   = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = 5 + Math.random() * 3;
    starPos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPos[i * 3 + 2] = r * Math.cos(phi);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat   = new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, transparent: true, opacity: 0.4 });
const starField = new THREE.Points(starGeo, starMat); // kept in scene permanently
scene.add(starField);

// --- Load config and bootstrap simulation ---
const SPECIES_AGENT_MAP = {
    starling:  'agents/agents_starling_100k.json',
    sardine:   'agents/agents_sardine_200k.json',
    gnat:      'agents/agents_gnat_50k.json',
    bat:       'agents/agents_bat_30k.json',
    firefly:   'agents/agents_firefly_10k.json',
    moth:      'agents/agents_moth_20k.json',
    locust:    'agents/agents_locust_80k.json',
    jellyfish: 'agents/agents_jellyfish_15k.json',
};

let simulation = null;
let boidRenderer = null;
let lod = null;
let gui = null;
let guiParams = null;
let clock = new THREE.Clock();
let frameCount = 0;

async function loadSpecies(species) {
    const path = SPECIES_AGENT_MAP[species] ?? SPECIES_AGENT_MAP['starling'];
    const config = await fetch(path).then(r => r.json());

    // Dispose previous simulation/renderer; preserve the permanent star field
    if (simulation)   { simulation.dispose(); }
    if (boidRenderer) {
        boidRenderer.dispose();
        // Remove only boid-related objects; leave starField
        scene.children
            .filter(c => c !== starField && (c.isMesh || c.isPoints || c.isLineSegments))
            .forEach(c => scene.remove(c));
    }

    simulation   = new Simulation(glRenderer, config);
    boidRenderer = new Renderer(glRenderer, scene, camera, config.agentCount, simulation.texSize);
    lod          = new LOD(camera);

    if (!gui) {
        const result = createGUI(simulation, boidRenderer, lod, loadSpecies);
        gui       = result.gui;
        guiParams = result.params;
    }

    // Expose loadSpecies for the HTML species bar (registered after module boots)
    window.__loadSpecies = loadSpecies;

    boidRenderer.setMode(guiParams?.renderMode ?? 'points');
}

// Resize handler
function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    glRenderer.setSize(window.innerWidth, window.innerHeight);
    overlay.width  = window.innerWidth;
    overlay.height = window.innerHeight;
}
window.addEventListener('resize', onResize);
onResize();

// --- Main loop ---
function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.05); // cap at 50ms
    frameCount++;

    controls.update();

    if (simulation) {
        simulation.update(dt);
        boidRenderer.update(
            simulation.getPositionTexture(),
            simulation.getVelocityTexture(),
            simulation.getTime()        );

        // LOD
        const centroid = new THREE.Vector3(0, 0, 0); // approximation; ideally computed from positions
        const lodMode  = lod.getMode(centroid);
        if (guiParams?.forceLOD === 'auto' && guiParams?.renderMode !== 'volumetric') {
            boidRenderer.setMode(lodMode === 'mesh' ? 'trails' : lodMode);
        }

        // HUD
        if (guiParams) {
            drawAnalysisHUD(ctx, {
                orderParameter:  simulation.getOrderParameter(),
                entropy:         simulation.getEntropy(),
                correlationData: simulation.analysis.correlationData,
            }, guiParams);
        }
    }

    glRenderer.render(scene, camera);
}

// --- Boot ---
const initialSpecies = window.location.hash.replace('#', '') || 'starling';
loadSpecies(initialSpecies).then(() => {
    animate();
}).catch(err => {
    console.error('Failed to load species:', err);
    // Fallback: load with minimal inline config
    const fallbackConfig = {
        species: 'starling', agentCount: 16384,
        separationRadius: 0.04, alignRadius: 0.10, cohesionRadius: 0.12,
        separationWeight: 1.5, alignWeight: 1.0, cohesionWeight: 1.0,
        maxSpeed: 0.4, minSpeed: 0.15, maxForce: 2.0,
        boundaryRadius: 0.90, boundaryWeight: 3.0,
    };
    simulation   = new Simulation(glRenderer, fallbackConfig);
    boidRenderer = new Renderer(glRenderer, scene, camera, fallbackConfig.agentCount, simulation.texSize);
    lod          = new LOD(camera);
    animate();
});
