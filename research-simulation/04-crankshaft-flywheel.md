# Simulation — Crankshaft and Flywheel

## What Is Simulated

The crankshaft is the integrator of all torque contributions. Its simulation is a
simple but central ODE: rotational dynamics. Getting this right determines whether
RPM response, acceleration, and torque fluctuation match the real engine.

---

## Rotational Dynamics (Core ODE)

```
  J × dω/dt = τ_net(θ, ω)

  dθ/dt = ω

  where:
    J      = total rotational inertia [kg·m²]
    ω      = angular velocity [rad/s]
    θ      = crank angle [rad]
    τ_net  = sum of all torque contributions [N·m]
```

This pair of first-order ODEs is the engine's equation of motion.

### Torque Contributions

```
  τ_net = τ_gas(θ) + τ_inertia(θ, ω) - τ_friction(θ, ω) - τ_load(ω)

  τ_gas(θ)      = F_gas(θ) × r × sin(θ + β) / cosβ       [combustion torque]
  τ_inertia(θ)  = -F_inertia(θ) × r × sin(θ + β) / cosβ  [reciprocating reaction]
  τ_friction    = from friction model (see [10-friction-losses](10-friction-losses.md))
  τ_load        = dyno load, accessory load, pumping loss
```

Note: τ_gas and τ_inertia both flow through the same rod, so their sum (the net rod
force) is the correct quantity:

```
  τ_piston = (F_gas - m_recip × a(θ)) × r × sin(θ + β) / cosβ
```

---

## Total Rotational Inertia J

```
  J_total = J_crankshaft_body + J_flywheel + J_harmonic_damper
            + Σ(m_rotating_rod_i × r²)
            + Σ(J_pulley_i)

  J_rod_rotating = (2/3) × m_con_rod × r²    (per cylinder)

  For a single-cylinder engine:
  J_total ≈ J_crankshaft + J_flywheel + (2/3) × m_con_rod × r²
```

### Effect of J on Simulation

- Higher J → slower RPM response (engine takes longer to accelerate or decelerate)
- Higher J → lower torque fluctuation (flywheel smooths combustion pulses)
- Getting J right is critical for matching RPM transient response to the real engine

A ±10% error in J causes a proportional error in dω/dt — the simulated engine will
accelerate or decelerate at the wrong rate.

---

## Numerical Integration

The ODE is integrated numerically. The state vector is [θ, ω].

### Euler Method (First Order)

```
  ω_new = ω + (τ_net / J) × Δt
  θ_new = θ + ω × Δt

  Δt = Δθ / ω    (step size in time for fixed crank angle step Δθ)
```

Simple but accumulates error. Adequate for Δθ ≤ 0.5°.

### Runge-Kutta 4 (RK4)

```
  k1 = f(t, [θ, ω])
  k2 = f(t + Δt/2, [θ + k1.θ×Δt/2, ω + k1.ω×Δt/2])
  k3 = f(t + Δt/2, [θ + k2.θ×Δt/2, ω + k2.ω×Δt/2])
  k4 = f(t + Δt, [θ + k3.θ×Δt, ω + k3.ω×Δt])

  [θ, ω]_new = [θ, ω] + (Δt/6)(k1 + 2k2 + 2k3 + k4)
```

4th-order accuracy — allows larger steps (Δθ ≤ 2°) for same accuracy as Euler at 0.1°.
Used in GT-Power and AVL BOOST for the crankshaft ODE.

### Recommended Step Size

At 6000 RPM, 1° ≈ 28 µs. Combustion events span ~30–50°.

| Step size | Events per combustion | Accuracy |
|---|---|---|
| 1.0° | 30–50 | Good for torque averages |
| 0.5° | 60–100 | Good for IMEP |
| 0.1° | 300–500 | Excellent, matches combustion analyser |
| 0.05° | 600–1000 | Matches Kistler data sampling resolution |

For near 1:1 accuracy: use Δθ = 0.1° with RK4, or Δθ = 0.5° with adaptive step-size
control.

---

## RPM Computation

```
  RPM = ω × 60 / (2π)
```

For display and audio synthesis, use a low-pass filtered RPM:
```
  RPM_display = RPM_display_prev + α × (RPM_instant - RPM_display_prev)

  α ≈ 0.01–0.05 per step    (smoothing factor)
```

---

## Torsional Vibration (Advanced)

A single rigid-body J model cannot capture torsional resonances. For that, the
crankshaft must be modelled as a series of inertia-spring segments:

```
  [J1, K12, J2, K23, J3, ...]

  Ji = inertia of each crank throw section + flywheel (for last node)
  Kij = torsional stiffness of shaft segment between i and j
```

This produces a multi-DOF torsional model that predicts resonant frequencies.
GT-Power's crankshaft module implements this. For most simulations, the single-J
model is adequate for torque output — torsional resonances affect internal stresses
but have small effect on brake torque (< 1% at off-resonance RPMs).

---

## Accuracy vs Measured Data

| Quantity | Single-J rigid model | Multi-J torsional model |
|---|---|---|
| Average torque | ±1–3% (dominated by combustion model) | ±1–2% |
| RPM transient | ±3–8% (J uncertainty) | ±2–5% |
| Crank-resolved torque | ±3–5% | ±2–3% |
| Torsional resonance RPM | Not predicted | ±2–5 Hz |
