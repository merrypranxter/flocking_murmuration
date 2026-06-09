# flocking_murmuration

A creative coding project exploring **GPU-accelerated flocking behavior** — the emergent collective motion of thousands of autonomous agents following simple local rules, producing the fluid, hypnotic patterns of starling murmurations, fish schools, and insect swarms.

## What Is Flocking?

Craig Reynolds' 1986 Boids algorithm demonstrates that complex group behavior emerges from three simple rules applied to each agent:

1. **Separation**: steer to avoid crowding local flockmates
2. **Alignment**: steer toward the average heading of local flockmates
3. **Cohesion**: steer toward the average position of local flockmates

On GPU, this becomes a GPGPU particle system: position and velocity textures are updated in fragment shader passes, allowing 262,000+ boids at 60fps — enough to fill the screen with living, breathing fluid.

## Project Structure

```
shaders/              # GLSL compute/update shaders — position, velocity, forces
agents/               # Boid parameter sets: starlings, sardines, gnats, bats
predators/            # Disruption agents: hawks, sharks, chaotic attractors
environments/         # Wind fields, thermal columns, boundary geometries
visual_modes/         # Point sprites, motion blur trails, volumetric rendering
spatial_structures/   # KD-tree, spatial hash, neighbor-lookup optimizations
analysis/             # Clustering metrics, entropy, order parameters
```

## Running

Shaders are written for WebGL/Three.js using ping-pong framebuffer techniques for GPGPU. Each simulation is self-contained — requires Three.js r128+ or equivalent WebGL2 context with float texture support.

## Current Flocking Variants

- [ ] _starling_murmuration — 100k agents, tight turning, predator evasion
- [ ] _sardine_ball — 200k agents, underwater, pressure-wave coherence
- [ ] _gnat_cloud — 50k agents, Brownian jitter, chaotic attraction
- [ ] _bat_emergence — 30k agents, cave-exit vortex, echolocation rings
- [ ] _firefly_dance — 10k agents, phase-coupled blinking, attractor sync
- [ ] _moth_swarm — 20k agents, positive phototaxis, lamp orbit decay
- [ ] _locust_plague — 80k agents, aligned marching, density-dependent phase shift
- [ ] _jellyfish_pulse — 15k agents, radial contraction waves, fluid coupling

## Predator / Disruption Modes

- [ ] _hawk_strike — single fast predator, schismogenesis in flock
- [ ] _peregrine_dive — stooping attack from above, vertical flock splitting
- [ ] _chaotic_attractor — Lorenz strange attractor as virtual predator path
- [ ] _wave_front — linear pressure wave, shorebird escape patterns
- [ ] _obstacle_field — static pillars, flow-around vortex streets
- [ ] _food_source — radial attractor with competition, territory formation

## Advanced Behaviors

- [ ] _scale_free_correlations — critical transition, velocity correlation length ∝ flock size
- [ ] _information_cascade — turning waves propagate faster than any individual boid
- [ ] _leaderless_turns — no individual initiates, yet the flock turns as one
- [ ] _dimensional_reduction — 3D flock collapses to 2D sheet when threatened
- [ ] _roosting_convergence — evening return to fixed points, path memory

## Performance Notes

- **Spatial hash**: O(1) neighbor lookup vs O(n²) brute force
- **Ping-pong textures**: GPU read/write via framebuffer swapping
- **MRT**: Multiple Render Targets for position/velocity/phase in single pass
- **Level-of-detail**: distant boids as point sprites, near as mesh instances
- **LOD distance**: 500px = billboard, 100px = 2-triangle mesh, 50px = full model

## References

- Reynolds, C. W. (1987). *Flocks, Herds, and Schools: A Distributed Behavioral Model*. ACM SIGGRAPH.
- Vicsek, T. et al. (1995). *Novel Type of Phase Transition in a System of Self-Driven Particles*. Phys. Rev. Lett.
- Cavagna, A. et al. (2010). *Scale-Free Correlations in Starling Flocks*. PNAS.
- Attanasi, A. et al. (2014). *Information Transfer and Behavioural Inertia in Starling Flocks*. Nature Physics.
- Sumpter, D. J. T. (2010). *Collective Animal Behavior*. Princeton University Press.
- Hartman, C. & Benes, B. (2006). *Autonomous Boids*. Computer Animation and Virtual Worlds.

---

*No bird knows the shape of the flock. Yet the flock has a shape, and it is beautiful.*
