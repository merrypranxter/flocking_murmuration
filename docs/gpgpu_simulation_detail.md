# gpgpu_simulation_detail.md
# GPGPU Boid Simulation — Technical Architecture

## Overview

GPU-General Purpose computation (GPGPU) enables simulating 100,000+ boids at 60fps by executing the boid update loop as a fragment shader over a full-screen quad, using framebuffer objects (FBOs) to store simulation state.

The key insight: **a fragment shader running over a W×H quad produces W×H outputs in parallel**. If each texel represents one agent, we can update all agents simultaneously on the GPU.

---

## Ping-Pong Framebuffer Pattern

State is stored in two render targets per variable:

```
Frame N:   Read from FBO_A → Write to FBO_B
Frame N+1: Read from FBO_B → Write to FBO_A
```

After each frame, we swap which buffer is "current". This is called ping-pong.

### Implementation (Three.js)

```javascript
// Two render targets per variable (position, velocity)
const rtA = new THREE.WebGLRenderTarget(texW, texH, { type: THREE.FloatType });
const rtB = new THREE.WebGLRenderTarget(texW, texH, { type: THREE.FloatType });
let current = 0;

function compute(updateMaterial) {
    updateMaterial.uniforms.positionTex.value = [rtA, rtB][current].texture;
    renderer.setRenderTarget([rtB, rtA][current]);
    renderer.render(scene, orthoCamera);
    current ^= 1; // swap
}
```

### Texture Encoding

| Variable | R        | G        | B        | A              |
|----------|----------|----------|----------|----------------|
| Position | pos.x    | pos.y    | pos.z    | agentId (norm) |
| Velocity | vel.x    | vel.y    | vel.z    | speed / phase  |

All textures use `THREE.FloatType` (RGBA32F) — requires `WebGL2` or `OES_texture_float` + `EXT_color_buffer_float`.

---

## Multiple Render Targets (MRT)

Instead of running two separate passes (one for position, one for velocity), we can write both in a single pass using `GL_EXT_draw_buffers`:

```glsl
#extension GL_EXT_draw_buffers : require
// ...
gl_FragData[0] = vec4(newPos, agentId);   // → positionTex FBO attachment
gl_FragData[1] = vec4(newVel, speed);     // → velocityTex FBO attachment
```

This halves the number of render passes at the cost of slightly more complex setup.

### MRT Setup (WebGL2)

```javascript
const ext = renderer.getContext().getExtension('WEBGL_draw_buffers');
// or in WebGL2: just use framebuffer.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
```

---

## Agent Indexing

Each agent is assigned a UV coordinate in the agent texture:

```glsl
vec2 indexToUV(float idx, float texSize) {
    float u = (mod(idx, texSize) + 0.5) / texSize;
    float v = (floor(idx / texSize) + 0.5) / texSize;
    return vec2(u, v);
}
```

In the update shader, the current agent's UV is:
```glsl
vec2 myUV = gl_FragCoord.xy / u_agentTexSize;
```

The `0.5` offset ensures we sample at texel centers.

---

## Texture Size Selection

For N agents, choose the smallest power-of-two square:
```
texSize = pow(2, ceil(log2(sqrt(N))))
```

| agentCount | texSize  |
|------------|----------|
| 1,024      | 32×32    |
| 16,384     | 128×128  |
| 65,536     | 256×256  |
| 262,144    | 512×512  |

---

## Spatial Hash Integration

The boid update shader reads neighbor data via spatial hash textures:

```glsl
uniform sampler2D u_hashTex;    // sorted agent index list (by cell)
uniform sampler2D u_cellsTex;   // per-cell (start, count) pairs
uniform float     u_hashTexSize;

// In main():
ivec3 myCell = worldToCell(pos);
for (int dz = -1; dz <= 1; dz++) {
for (int dy = -1; dy <= 1; dy++) {
for (int dx = -1; dx <= 1; dx++) {
    ivec3 nc = myCell + ivec3(dx, dy, dz);
    vec2 cr = cellRange(u_cellsTex, u_hashTexSize, cellIndex(nc));
    for (int k = 0; k < MAX_CELL; k++) {
        if (k >= int(cr.y)) break;
        float nIdxNorm = hashEntry(u_hashTex, u_hashTexSize, int(cr.x) + k);
        vec2 nUV = agentUV(nIdxNorm, u_agentTexSize);
        // ... read neighbor position/velocity ...
    }
}}}
```

Hash tables are rebuilt CPU-side each frame from a GPU readback (synchronous) or asynchronously using Pixel Buffer Objects (async).

---

## Memory Budget

For 262,144 agents at RGBA32F (16 bytes/texel):

| Buffer       | Size       | Notes                          |
|--------------|------------|--------------------------------|
| Position (×2)| 8 MB       | Ping-pong pair                 |
| Velocity (×2)| 8 MB       | Ping-pong pair                 |
| Hash sorted  | 4 MB       | One float per agent            |
| Cell table   | 16 MB      | 64³ cells × 16 bytes           |
| Density (vol)| 1 MB       | 512×512 density splat          |
| **Total**    | **~37 MB** | Well within 4GB VRAM budget    |

---

## Performance Targets

| Agent Count | GPU          | Framerate |
|-------------|--------------|-----------|
| 65,536      | GTX 1060     | 60 fps    |
| 131,072     | RTX 2070     | 60 fps    |
| 262,144     | RTX 3080     | 60 fps    |
| 262,144     | GTX 1060     | ~25 fps   |

Bottleneck is typically the CPU-side spatial hash rebuild (readback + sort).
Use async pixel buffer readback to overlap GPU compute with CPU hash sort.

---

## WebGL2 Checklist

- [x] `OES_texture_float` or WebGL2 built-in float textures
- [x] `EXT_color_buffer_float` (required for rendering to float textures)
- [x] `WEBGL_draw_buffers` or WebGL2 drawBuffers (for MRT)
- [x] `OES_vertex_array_object` (for efficient geometry setup)
- [x] `highp float` precision in fragment shaders

---

## References

- Rákos & García-Dorado (2010). *GPU Pro* Chapter: GPGPU Particle Systems
- Pharr, M. & Fernando, R. (2005). *GPU Gems 2*, Ch. 40: GPGPU Fluid Simulation
- Three.js GPUComputationRenderer source: `examples/jsm/misc/GPUComputationRenderer.js`
