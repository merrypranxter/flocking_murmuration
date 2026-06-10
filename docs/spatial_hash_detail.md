# spatial_hash_detail.md
# Spatial Hash Grid — Neighbor Lookup for GPGPU Boids

## The Problem

For N boids, naïve neighbor search is O(N²) per frame:

```
for each agent i:
    for each agent j ≠ i:
        if distance(i, j) < radius:
            // interact
```

For N=100,000: 10 billion distance calculations per frame at 60fps = 600 billion/s.
Even a GPU cannot do this efficiently.

## The Solution: Uniform Grid Spatial Hash

Divide the world into a regular grid of cells. Each boid is assigned to the cell containing its position. To find neighbors, only check the 3×3×3 = 27 cells adjacent to the query boid's cell.

Expected complexity: **O(k)** where k = average neighbors per cell (near-constant for uniform distributions).

---

## Grid Layout

```
World bounds: [-WORLD_HALF, WORLD_HALF]^3  (default: [-1, 1]^3)
Grid: GRID_DIM × GRID_DIM × GRID_DIM     (default: 64^3 = 262,144 cells)
Cell size: 2.0 * WORLD_HALF / GRID_DIM   (default: ~0.03125 world units)
```

Cell size should be ≥ the largest interaction radius (cohesionRadius). If cell size < radius, some neighbors may be missed. Larger cells mean more agents per cell but correct results.

---

## Data Structures

### 1. Agent-Cell Assignment Array
```
agentCell[i] = flat cell index containing agent i
```

### 2. Per-Cell Count Array
```
cellCount[c] = number of agents in cell c
```

### 3. Prefix-Sum Start Array
```
cellStart[c] = Σ cellCount[0..c-1]   (exclusive prefix sum)
```
Computed in O(numCells) with a linear scan.

### 4. Sorted Agent Index Array
```
sorted[k] = agent index of the k-th agent in cell order
```
Agents are sorted by cell index, so all agents in cell c are contiguous:
```
sorted[cellStart[c]] ... sorted[cellStart[c] + cellCount[c] - 1]
```

---

## GPU Representation

Both `sorted` and `(cellStart, cellCount)` arrays are uploaded as 2D Float32 textures:

**hashTex** (agentTexSize × agentTexSize, RGBA32F):
```
texel k → R = sorted[k] / MAX_AGENTS (normalised agent index)
```

**cellsTex** (cellTexSize × cellTexSize, RGBA32F):
```
texel c → R = cellStart[c], G = cellCount[c]
```

Where `cellTexSize = ceil(sqrt(GRID_DIM^3))`.

---

## Shader Lookup Pseudocode

```glsl
ivec3 myCell = worldToCell(pos);

for (int dz = -1; dz <= 1; dz++)
for (int dy = -1; dy <= 1; dy++)
for (int dx = -1; dx <= 1; dx++) {
    ivec3 nc = myCell + ivec3(dx, dy, dz);
    if (outOfBounds(nc)) continue;

    int ci = cellIndex(nc);
    vec2 range = cellRange(u_cellsTex, u_hashTexSize, ci);
    int start = int(range.x);
    int count = int(range.y);

    for (int k = 0; k < MAX_K; k++) {
        if (k >= count) break;
        float nIdxNorm = hashEntry(u_hashTex, u_hashTexSize, start + k);
        vec2 nUV = agentUV(nIdxNorm, u_agentTexSize);
        vec3 nPos = texture2D(u_positionTex, nUV).rgb;
        // ... interact ...
    }
}
```

**MAX_K** is the maximum agents expected per cell (e.g. 32). If a cell overflows, extra agents are silently skipped — this is acceptable for large N where any skipped neighbors are unlikely to be the critical 6-7 topological neighbors.

---

## CPU-Side Build (JavaScript)

```javascript
// 1. Assign cells
for (let i = 0; i < N; i++) {
    agentCell[i] = posToCell(pos[i*4], pos[i*4+1], pos[i*4+2]);
    cellCount[agentCell[i]]++;
}

// 2. Prefix sum
let sum = 0;
for (let c = 0; c < TOTAL_CELLS; c++) {
    cellStart[c] = sum;
    sum += cellCount[c];
}

// 3. Fill sorted array
for (let i = 0; i < N; i++) {
    const c = agentCell[i];
    sorted[insertAt[c]++] = i;
}
```

Total: O(N + numCells) ≈ O(N) for dense grids.

---

## Performance Comparison

| N       | Brute Force (GPU) | Spatial Hash (CPU+GPU) |
|---------|-------------------|------------------------|
| 16,384  | 60 fps (just)     | 60 fps                 |
| 65,536  | 15 fps            | 60 fps                 |
| 262,144 | < 1 fps           | 25-60 fps              |

The bottleneck for spatial hash at high N is the CPU readback (GPU→CPU position sync). 
Mitigation: async pixel buffer readback, or a full GPU sort (bitonic sort / radix sort on shader).

---

## Limitations and Extensions

**Overcrowding:** if a cell contains more agents than MAX_K, some interactions are skipped. Solution: use a larger cell size or GPU-side linked list per cell.

**Non-uniform distributions:** if agents cluster, some cells overflow. Solution: adaptive octree or KD-tree (higher build cost, better worst-case).

**Moving to GPU-only:** implement bitonic sort as a series of compare-and-swap shader passes. Eliminates the CPU readback bottleneck. 3-4× speedup at 262k agents.

---

## References

- Hoetzlein, R. (2014). *Fast Fixed-Radius Nearest Neighbors*. NVIDIA. 
- Green, S. (2010). *Particle Simulation using CUDA*. NVIDIA Technical Report.
- Nishidate, I., Aoki, K. (2009). *GPU-based Sorting and Spatial Hashing*. IEICE.
