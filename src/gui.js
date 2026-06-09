/**
 * gui.js
 * dat.GUI parameter panel for real-time flocking simulation control.
 *
 * Creates a sidebar with collapsible folders for:
 *   - Species selection
 *   - Boid parameters (separation, alignment, cohesion, speed)
 *   - Predator mode
 *   - Render mode
 *   - Analysis overlay
 *   - Performance stats
 */

import GUI from 'dat.gui';

export function createGUI(simulation, renderer, lod, onSpeciesChange) {
    const gui = new GUI({ width: 320 });
    gui.domElement.style.position = 'fixed';
    gui.domElement.style.top      = '10px';
    gui.domElement.style.right    = '10px';

    const params = {
        // Species
        species:           simulation.config.species,

        // Boid physics
        separationRadius:  simulation.config.separationRadius,
        alignRadius:       simulation.config.alignRadius,
        cohesionRadius:    simulation.config.cohesionRadius,
        separationWeight:  simulation.config.separationWeight,
        alignWeight:       simulation.config.alignWeight,
        cohesionWeight:    simulation.config.cohesionWeight,
        maxSpeed:          simulation.config.maxSpeed,

        // Predator
        predatorMode:      'none',
        predatorActive:    false,

        // Render
        renderMode:        'points',
        forceLOD:          'auto',
        pointSize:         3.0,
        trailLength:       0.05,
        opacity:           0.85,

        // Analysis overlay
        showOrderParam:    true,
        showEntropy:       false,
        showCorrelation:   false,
    };

    // --- Species ---
    const speciesFolder = gui.addFolder('Species');
    speciesFolder.add(params, 'species', [
        'starling', 'sardine', 'gnat', 'bat',
        'firefly', 'moth', 'locust', 'jellyfish'
    ]).name('Flock Type').onChange(v => onSpeciesChange(v));
    speciesFolder.open();

    // --- Boid parameters ---
    const boidsFolder = gui.addFolder('Boid Rules');
    const uniformUpdater = (name) => (v) => simulation.setUniform(name, v);
    boidsFolder.add(params, 'separationRadius', 0.01, 0.20).onChange(uniformUpdater('u_separationRadius'));
    boidsFolder.add(params, 'alignRadius',      0.02, 0.30).onChange(uniformUpdater('u_alignRadius'));
    boidsFolder.add(params, 'cohesionRadius',   0.02, 0.40).onChange(uniformUpdater('u_cohesionRadius'));
    boidsFolder.add(params, 'separationWeight', 0.0,  5.0 ).onChange(uniformUpdater('u_separationWeight'));
    boidsFolder.add(params, 'alignWeight',      0.0,  5.0 ).onChange(uniformUpdater('u_alignWeight'));
    boidsFolder.add(params, 'cohesionWeight',   0.0,  5.0 ).onChange(uniformUpdater('u_cohesionWeight'));
    boidsFolder.add(params, 'maxSpeed',         0.05, 1.0 ).onChange(uniformUpdater('u_maxSpeed'));
    boidsFolder.open();

    // --- Predator ---
    const predFolder = gui.addFolder('Predator');
    predFolder.add(params, 'predatorMode', [
        'none', 'hawk', 'peregrine', 'chaotic', 'wave', 'obstacle', 'food'
    ]).name('Mode').onChange(v => {
        params.predatorActive = (v !== 'none');
        simulation.setPredator(simulation._predatorPos, params.predatorActive);
    });
    predFolder.add(params, 'predatorActive').name('Active').onChange(v =>
        simulation.setPredator(simulation._predatorPos, v)
    );

    // --- Render ---
    const renderFolder = gui.addFolder('Render');
    renderFolder.add(params, 'renderMode', ['points', 'trails', 'volumetric']).name('Mode').onChange(v => {
        renderer.setMode(v);
    });
    renderFolder.add(params, 'forceLOD', ['auto', 'points', 'trails', 'mesh']).name('Force LOD').onChange(v => {
        if (v === 'auto') lod.clearForced();
        else lod.setForced(v);
    });
    renderFolder.add(params, 'pointSize',  1.0, 8.0).onChange(v =>
        renderer.setParam('u_pointSize', v)
    );
    renderFolder.add(params, 'trailLength', 0.01, 0.20).onChange(v =>
        renderer.setParam('u_trailLength', v)
    );
    renderFolder.add(params, 'opacity', 0.1, 1.0).onChange(v =>
        renderer.setParam('u_opacity', v)
    );

    // --- Analysis ---
    const analysisFolder = gui.addFolder('Analysis');
    analysisFolder.add(params, 'showOrderParam').name('Order Parameter');
    analysisFolder.add(params, 'showEntropy').name('Entropy Map');
    analysisFolder.add(params, 'showCorrelation').name('Correlation C(r)');

    return { gui, params };
}

/**
 * Draw analysis HUD onto a 2D canvas overlay.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} analysis — { orderParameter, entropy, correlationData }
 * @param {object} params   — GUI params
 */
export function drawAnalysisHUD(ctx, analysis, params) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';

    let y = 20;

    if (params.showOrderParam) {
        const phi = analysis.orderParameter.toFixed(3);
        ctx.fillText(`φ (order): ${phi}`, 12, y);
        // Mini bar
        ctx.fillStyle = 'rgba(100,200,255,0.7)';
        ctx.fillRect(150, y - 12, analysis.orderParameter * 120, 14);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        y += 20;
    }

    if (params.showEntropy) {
        const H_val = analysis.entropy.toFixed(3);
        ctx.fillText(`H (entropy): ${H_val}`, 12, y);
        ctx.fillStyle = 'rgba(255,150,100,0.7)';
        ctx.fillRect(150, y - 12, analysis.entropy * 120, 14);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        y += 20;
    }

    if (params.showCorrelation && analysis.correlationData) {
        ctx.fillText('C(r):', 12, y);
        y += 4;
        const barW = 2;
        const barH = 40;
        const nBins = 128;
        for (let i = 0; i < nBins; i++) {
            const c = analysis.correlationData[i * 4]; // R channel = correlation value
            const barHeight = Math.abs(c) * barH;
            ctx.fillStyle = c > 0
                ? `rgba(100,200,255,${Math.min(1, Math.abs(c) + 0.2)})`
                : `rgba(255,100,100,${Math.min(1, Math.abs(c) + 0.2)})`;
            ctx.fillRect(12 + i * barW, y + barH - barHeight, barW - 1, barHeight);
        }
        y += barH + 4;
    }
}
