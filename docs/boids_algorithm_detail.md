# boids_algorithm_detail.md
# Reynolds' Boids Algorithm — Detailed Notes

## Overview

Craig Reynolds' 1987 Boids model ("Boids, Herds, and Schools: A Distributed Behavioral Model") demonstrates that complex collective motion emerges from three simple local rules applied in parallel to each agent. There is no global coordinator, no shared memory, no leader.

The rules:

1. **Separation** — avoid collisions with local flockmates: steer away from agents within a personal-space radius.
2. **Alignment** — steer toward the average velocity (heading) of nearby agents.
3. **Cohesion** — steer toward the average position (center of mass) of nearby agents.

Each rule produces a _desired velocity_ vector. These are weighted and summed to produce a _steering force_, which is added to the agent's current velocity. Velocity is then clamped to `[minSpeed, maxSpeed]`.

---

## The Steering Force Model

```
steering = Σ wᵢ · truncate(desired_i - velocity, maxForce)
```

For each rule:

### Separation
```
for each neighbor n within separationRadius:
    desired += (pos - n.pos) / |pos - n.pos|  // away from neighbor, weighted by 1/dist
desired = normalize(desired) * maxSpeed
separation_force = truncate(desired - vel, maxForce) * separationWeight
```

### Alignment
```
for each neighbor n within alignRadius:
    velSum += n.vel
desired = normalize(velSum / neighborCount) * maxSpeed
alignment_force = truncate(desired - vel, maxForce) * alignWeight
```

### Cohesion
```
for each neighbor n within cohesionRadius:
    posSum += n.pos
desired = normalize(posSum / neighborCount - pos) * maxSpeed  // toward centroid
cohesion_force = truncate(desired - vel, maxForce) * cohesionWeight
```

The `truncate(v, max)` operation clamps the _magnitude_ of `v` to `max`, preserving direction. This is the "Reynolds truncation" that produces realistic steering behavior.

---

## Topological vs. Metric Neighborhoods

**Metric** (classic Boids): each agent interacts with all agents within a fixed radius _r_. Simple, but produces density-dependent behavior — dense flocks have more neighbors than sparse ones.

**Topological** (Cavagna et al. 2010): each agent tracks its 6-7 nearest neighbors _regardless_ of absolute distance. This is what real starlings do. Consequences:

- Interaction range adapts to local density
- Perturbations propagate across the whole flock regardless of size
- Correlation length ξ scales with flock size N (scale-free correlations)
- The flock is always "near" the critical point — poised for maximum information transfer

Implementation: sort neighbors by distance, take top `topoN`. In GPGPU, this requires a sorting pass or maintaining a priority queue per agent, which is expensive. The shader approximation: iterate over all neighbors in the spatial hash, accumulate only the `topoN` closest.

---

## Emergent Phenomena

### Information Cascades
A turning wave initiated by a few peripheral birds propagates across a murmuration at ~20-40 m/s — far faster than any individual's reaction time allows direct neighbor-to-neighbor relay at individual speeds (~8-12 m/s). The cascade is super-individual because:
- Near-critical ordering amplifies perturbation propagation
- Topological interactions ensure the signal doesn't attenuate with density
- "Behavioural inertia" is minimized (Attanasi et al. 2014)

### Leaderless Turns
No individual initiates a turn; turns emerge spontaneously from fluctuations near the critical point. A small group of boundary birds is perturbed (by a predator, thermal, or random fluctuation); the perturbation amplifies if the flock is near its critical density of interaction.

### Dimensional Reduction
Under extreme threat, 3D flocks flatten to 2D sheets temporarily — increasing the confusion effect (predators struggle with 2D pursuit), decreasing target profile, and enabling faster collective turns on a single plane.

### Schismogenesis (Flock Split)
A direct hawk strike splits the flock along the approach axis: birds in the hawk's path flee radially, birds outside it continue normally, creating a "hole" that reforms. The split is not random — it has bilateral symmetry along the attack vector.

---

## Parameter Tuning Guide

| Parameter         | Effect if increased              | Effect if decreased           |
|-------------------|----------------------------------|-------------------------------|
| separationRadius  | More personal space → looser     | Denser packing               |
| separationWeight  | Individual avoidance → splitting | Allows overlap               |
| alignRadius       | Wider alignment → global order   | Local clusters               |
| alignWeight       | Sharper alignment → rigid        | More individual variance     |
| cohesionRadius    | Larger flock blob                | Smaller sub-clusters         |
| cohesionWeight    | Tighter packing                  | Looser, more diffuse         |
| maxSpeed          | Faster, more dynamic             | Slower, calmer               |
| maxForce          | Sharper turns                    | Gradual turns                |

---

## References

- Reynolds, C. W. (1987). *Flocks, Herds, and Schools: A Distributed Behavioral Model*. ACM SIGGRAPH Computer Graphics, 21(4), 25–34.
- Cavagna, A., et al. (2010). *Scale-Free Correlations in Starling Flocks*. PNAS, 107(26), 11865–11870.
- Attanasi, A., et al. (2014). *Information Transfer and Behavioural Inertia in Starling Flocks*. Nature Physics, 10, 691–696.
- Vicsek, T., et al. (1995). *Novel Type of Phase Transition in a System of Self-Driven Particles*. PRL, 75(6), 1226.
- Sumpter, D. J. T. (2010). *Collective Animal Behavior*. Princeton University Press.
