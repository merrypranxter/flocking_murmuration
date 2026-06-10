# scale_free_correlations_detail.md
# Scale-Free Correlations and Critical Behavior in Starling Flocks

## The Discovery

In 2010, Cavagna et al. (PNAS) reported something remarkable: in starling murmurations, the velocity correlation length ξ is not fixed — it scales proportionally with the size of the flock.

```
ξ ∝ N^(1/3)   (approximately, for a 3D flock of N individuals)
```

This means: the larger the flock, the further the influence of a local perturbation propagates — without any individual bird having global knowledge.

This is **scale-free behavior**, a hallmark of systems poised at a second-order phase transition (critical point).

---

## What is a Correlation Length?

The velocity correlation function C(r) measures how similar two birds' velocities are, on average, as a function of their distance r:

```
C(r) = ⟨δv̂(r₀) · δv̂(r₀ + r)⟩ / ⟨δv²⟩
```

where δv̂ is the fluctuation in velocity direction from the mean.

- **C(0) = 1** (a bird correlates perfectly with itself)
- **C(r) → 0** as r → ∞ (distant birds are uncorrelated)
- The **correlation length ξ** is where C(ξ) = 1/e ≈ 0.37

In a non-critical system (e.g. random agents), ξ is small and independent of N.
In a critical system (starlings), ξ grows with N.

---

## The Vicsek Phase Transition

Vicsek et al. (1995) showed that a minimal self-propelled particle model undergoes a phase transition:

- **Below critical density / noise**: agents move randomly, φ ≈ 0 (disordered)
- **Above critical density / noise**: agents align globally, φ ≈ 1 (ordered)
- **At the critical point**: scale-free fluctuations, ξ ∝ N

The order parameter is the normalized mean velocity:

```
φ = |⟨v̂⟩|  ∈ [0, 1]
```

Real murmurations operate near but not exactly at the critical point — they are "poised" to allow rapid collective response while maintaining flock coherence.

---

## Why Poised at Criticality?

Being near the critical point maximizes information transfer speed: a perturbation (predator strike) propagates as far and as fast as possible. This is the "optimal criticality" hypothesis (Mora & Bialek 2011):

> Biological systems that must respond rapidly to environmental changes evolve to operate near critical transitions.

Evidence:
- Starling murmurations: velocity correlations span the whole flock
- Cortical neural networks: avalanche size distributions follow power laws
- Insect swarms: susceptibility (response to perturbation) peaks near critical density
- Gene regulatory networks: Boolean network models at critical connectivity

---

## Measuring Scale-Free Correlations in Simulation

The `analysis_velocity_correlation.frag` shader computes C(r) by Monte Carlo sampling:

```glsl
// For each sampled pair (i, j):
float dist = length(pos_i - pos_j);
float corr = dot(normalize(vel_i), normalize(vel_j));
// Accumulate into distance bin
```

After ~100 frames of accumulation, C(r) converges. Signs of scale-free behavior:
- C(r) does not decay exponentially (no characteristic scale)
- C(r) may follow a power law: C(r) ~ r^(-α)
- The correlation length ξ (where C drops to 1/e) grows when N is increased

In the GUI, the "Correlation C(r)" overlay shows this 1D function in real time.

---

## Tuning for Near-Critical Behavior

To push the simulation toward the critical point:

1. **Increase cohesion weight** slightly (denser packing increases effective density)
2. **Add noise** (small random perturbations to velocity) — noise is the "temperature" in the Vicsek model
3. **Use topological neighborhood** (Cavagna model) — the interaction range adapts to density, which is what pins the system near criticality regardless of absolute density

The simulation parameter that most directly controls the phase transition is the **alignment weight** (u_alignWeight):
- Low values → disordered phase (φ → 0)  
- High values → ordered phase (φ → 1)
- Near-critical → φ ≈ 0.5-0.7, large fluctuations in φ over time

Watch the order parameter in the analysis HUD: near criticality it will fluctuate between ~0.4 and ~0.9 on timescales of seconds, even without any perturbation. This spontaneous fluctuation is the signature of critical behavior.

---

## Information Cascade Velocity

At criticality, the speed of information propagation v_info is:

```
v_info = v_boid * ξ/ℓ
```

where ℓ is the interaction range and ξ is the correlation length.

For ξ/ℓ >> 1 (scale-free regime), v_info >> v_boid. In the simulation, this appears as the "wave front" predator mode producing a turning wave that crosses the flock far faster than any boid moves.

---

## References

- Cavagna, A., et al. (2010). *Scale-Free Correlations in Starling Flocks*. PNAS, 107(26).
- Vicsek, T., et al. (1995). *Novel Type of Phase Transition in a System of Self-Driven Particles*. PRL, 75(6), 1226.
- Attanasi, A., et al. (2014). *Information Transfer and Behavioural Inertia in Starling Flocks*. Nature Physics, 10, 691–696.
- Mora, T. & Bialek, W. (2011). *Are Biological Systems Poised at Criticality?* J. Stat. Phys., 144(2), 268–302.
- Bialek, W., et al. (2012). *Statistical mechanics for natural flocks of birds*. PNAS, 109(13), 4786–4791.
