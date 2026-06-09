/**
 * lod.js
 * Level-of-Detail manager for boid rendering.
 *
 * Three LOD tiers based on camera distance to flock centroid:
 *   NEAR   (dist < 0.5)  → mesh instances (full 2-triangle bird silhouette)
 *   MID    (dist < 1.5)  → motion trails (line segments)
 *   FAR    (dist ≥ 1.5)  → point sprites
 *
 * For very large flocks (100k+) we always use 'points'; LOD is meaningful
 * for smaller counts (< 20k) or split renders (near boids as mesh, rest as points).
 *
 * Thresholds are configurable and can be overridden per-species.
 */

export class LOD {
    constructor(camera, config = {}) {
        this.camera = camera;
        this.nearThreshold = config.nearThreshold ?? 0.5;
        this.midThreshold  = config.midThreshold  ?? 1.5;
        this.forcedMode    = config.forcedMode    ?? null; // override all LOD logic
    }

    /**
     * Compute the current render mode given flock centroid.
     * @param {THREE.Vector3} flockCentroid
     * @returns {'points'|'trails'|'mesh'}
     */
    getMode(flockCentroid) {
        if (this.forcedMode) return this.forcedMode;

        const camPos = this.camera.position;
        const dx = camPos.x - flockCentroid.x;
        const dy = camPos.y - flockCentroid.y;
        const dz = camPos.z - flockCentroid.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

        if (dist < this.nearThreshold)  return 'mesh';
        if (dist < this.midThreshold)   return 'trails';
        return 'points';
    }

    setForced(mode) { this.forcedMode = mode; }
    clearForced()   { this.forcedMode = null; }
}
