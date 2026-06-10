/**
 * spatial_hash.js
 * CPU-side spatial hash grid for GPGPU neighbor lookup.
 *
 * Builds a sorted index table and a per-cell (start, count) table each frame,
 * then uploads both as Float32 textures. The GPU update shaders read these
 * textures to find neighbors in O(1) amortized time.
 *
 * Grid: GRID_DIM^3 cells, world range [-WORLD_HALF, WORLD_HALF]^3.
 * Position data is read from a GPU Float32Array readback each frame.
 *
 * Performance note: the readback (GPU→CPU) is the bottleneck at high counts.
 * For 100k+ agents use async readback (EXT_disjoint_timer_query or transform
 * feedback) or keep the sort on GPU (prefix-sum / bitonic sort shaders).
 */

export const GRID_DIM    = 64;
export const WORLD_HALF  = 1.0;
export const CELL_SIZE   = (2.0 * WORLD_HALF) / GRID_DIM;
export const MAX_AGENTS  = 262144; // 512 x 512

export class SpatialHash {
    constructor(agentCount) {
        this.agentCount = agentCount;
        const total = GRID_DIM * GRID_DIM * GRID_DIM;

        this._cellCount  = new Int32Array(total);
        this._cellStart  = new Int32Array(total);
        this._sorted     = new Int32Array(agentCount);
        this._agentCell  = new Int32Array(agentCount);

        // Texture data arrays (Float32, RGBA)
        const texSize = Math.ceil(Math.sqrt(agentCount));
        this.texSize  = texSize;
        // hashTex: R = normalised agent index (in sorted order)
        this.hashData = new Float32Array(texSize * texSize * 4);
        // cellsTex: R = start index, G = count
        this.cellData = new Float32Array(total * 4);
    }

    /** World position → flat cell index */
    posToCell(x, y, z) {
        const cx = Math.max(0, Math.min(GRID_DIM - 1, Math.floor((x + WORLD_HALF) / CELL_SIZE)));
        const cy = Math.max(0, Math.min(GRID_DIM - 1, Math.floor((y + WORLD_HALF) / CELL_SIZE)));
        const cz = Math.max(0, Math.min(GRID_DIM - 1, Math.floor((z + WORLD_HALF) / CELL_SIZE)));
        return cz * GRID_DIM * GRID_DIM + cy * GRID_DIM + cx;
    }

    /**
     * Rebuild hash tables from a Float32Array of agent positions.
     * @param {Float32Array} positions — interleaved [x,y,z,w, x,y,z,w, ...]
     *                                   row-major from agentTexSize×agentTexSize texture readback
     */
    build(positions) {
        const total = GRID_DIM * GRID_DIM * GRID_DIM;
        this._cellCount.fill(0);

        // Assign each agent to a cell
        for (let i = 0; i < this.agentCount; i++) {
            const x = positions[i * 4 + 0];
            const y = positions[i * 4 + 1];
            const z = positions[i * 4 + 2];
            const cell = this.posToCell(x, y, z);
            this._agentCell[i] = cell;
            this._cellCount[cell]++;
        }

        // Prefix sum for start indices
        let sum = 0;
        for (let c = 0; c < total; c++) {
            this._cellStart[c] = sum;
            sum += this._cellCount[c];
        }

        // Fill sorted array (agents ordered by cell)
        const insertAt = this._cellStart.slice(); // copy
        for (let i = 0; i < this.agentCount; i++) {
            const cell = this._agentCell[i];
            this._sorted[insertAt[cell]++] = i;
        }

        // Write hashData: texel k → normalized agent index at sorted position k
        for (let k = 0; k < this.agentCount; k++) {
            const base = k * 4;
            this.hashData[base + 0] = this._sorted[k] / MAX_AGENTS; // normalised idx
            this.hashData[base + 1] = 0;
            this.hashData[base + 2] = 0;
            this.hashData[base + 3] = 1;
        }

        // Write cellData: texel c → (start, count)
        const cellTexSize = Math.ceil(Math.sqrt(total));
        for (let c = 0; c < total; c++) {
            const base = c * 4;
            this.cellData[base + 0] = this._cellStart[c];
            this.cellData[base + 1] = this._cellCount[c];
            this.cellData[base + 2] = 0;
            this.cellData[base + 3] = 1;
        }
    }

    /** Nearest-neighbor count (brute-force within one cell) — used for analysis */
    countNeighborsInRadius(positions, agentIdx, radius) {
        const px = positions[agentIdx * 4 + 0];
        const py = positions[agentIdx * 4 + 1];
        const pz = positions[agentIdx * 4 + 2];
        const r2 = radius * radius;
        let count = 0;

        const cxMin = Math.max(0, Math.floor((px - radius + WORLD_HALF) / CELL_SIZE));
        const cyMin = Math.max(0, Math.floor((py - radius + WORLD_HALF) / CELL_SIZE));
        const czMin = Math.max(0, Math.floor((pz - radius + WORLD_HALF) / CELL_SIZE));
        const cxMax = Math.min(GRID_DIM - 1, Math.floor((px + radius + WORLD_HALF) / CELL_SIZE));
        const cyMax = Math.min(GRID_DIM - 1, Math.floor((py + radius + WORLD_HALF) / CELL_SIZE));
        const czMax = Math.min(GRID_DIM - 1, Math.floor((pz + radius + WORLD_HALF) / CELL_SIZE));

        for (let cz = czMin; cz <= czMax; cz++) {
        for (let cy = cyMin; cy <= cyMax; cy++) {
        for (let cx = cxMin; cx <= cxMax; cx++) {
            const c = cz * GRID_DIM * GRID_DIM + cy * GRID_DIM + cx;
            const start = this._cellStart[c];
            const end   = start + this._cellCount[c];
            for (let s = start; s < end; s++) {
                const j = this._sorted[s];
                if (j === agentIdx) continue;
                const dx = positions[j * 4 + 0] - px;
                const dy = positions[j * 4 + 1] - py;
                const dz = positions[j * 4 + 2] - pz;
                if (dx*dx + dy*dy + dz*dz < r2) count++;
            }
        }}}
        return count;
    }
}
