// spatial_hash.glsl
// Uniform-grid spatial hash for O(1) neighbor lookup in GPGPU boid simulations.
// Include this file in update shaders via #include or copy-paste before main().
//
// The spatial hash maps 3D world-space into a flat texture:
//   hashTex  — RGBA32F, each texel encodes one (agentIndex, cellKey, -, -) entry
//   cellsTex — RGBA32F, each texel encodes (start, count, -, -) for a grid cell
//
// Grid resolution: HASH_GRID_DIM x HASH_GRID_DIM x HASH_GRID_DIM cells
// World bounds: [-HASH_WORLD_HALF, HASH_WORLD_HALF]^3

#ifndef SPATIAL_HASH_GLSL
#define SPATIAL_HASH_GLSL

#define HASH_GRID_DIM   64
#define HASH_GRID_DIM_F 64.0
#define HASH_WORLD_HALF 1.0
#define HASH_MAX_AGENTS 262144.0   // 512 x 512 texture

// Uniforms provided by the CPU:
//   uniform sampler2D u_hashTex;     // sorted (agentIndex, cellKey) pairs
//   uniform sampler2D u_cellsTex;    // per-cell (startIndex, count) pairs
//   uniform float     u_hashTexSize; // width == height of hash + cell textures

// --- Cell coordinate from world position ---
ivec3 worldToCell(vec3 pos) {
    vec3 norm = (pos + HASH_WORLD_HALF) / (2.0 * HASH_WORLD_HALF); // [0,1]
    norm = clamp(norm, 0.0, 1.0 - 1e-4);
    return ivec3(norm * HASH_GRID_DIM_F);
}

// --- Flat cell index (1D) from 3D cell ---
int cellIndex(ivec3 c) {
    return c.z * HASH_GRID_DIM * HASH_GRID_DIM + c.y * HASH_GRID_DIM + c.x;
}

// --- Read (start, count) for a 1D cell index ---
// Returns vec2(startIndex, count)  or  vec2(-1.0, 0.0) if empty.
vec2 cellRange(sampler2D cellsTex, float texSize, int idx) {
    float u = (float(idx % int(texSize)) + 0.5) / texSize;
    float v = (float(idx / int(texSize)) + 0.5) / texSize;
    vec4 cell = texture2D(cellsTex, vec2(u, v));
    return cell.xy; // x=start, y=count
}

// --- Read agent index from hash texture at sorted position ---
float hashEntry(sampler2D hashTex, float texSize, int sortedIdx) {
    float u = (float(sortedIdx % int(texSize)) + 0.5) / texSize;
    float v = (float(sortedIdx / int(texSize)) + 0.5) / texSize;
    return texture2D(hashTex, vec2(u, v)).r; // agent index (normalized 0-1)
}

// --- Neighbor iteration macro-style helper ---
// Call inside a loop over adjacent cells (-1..+1 in each axis).
// Returns the world-space UV into the position/velocity texture for a given agent.
vec2 agentUV(float agentIdxNorm, float agentTexSize) {
    float idx = agentIdxNorm * HASH_MAX_AGENTS;
    float u = (mod(idx, agentTexSize) + 0.5) / agentTexSize;
    float v = (floor(idx / agentTexSize) + 0.5) / agentTexSize;
    return vec2(u, v);
}

#endif // SPATIAL_HASH_GLSL
