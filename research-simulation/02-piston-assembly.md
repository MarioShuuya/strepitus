# Simulation — Piston Assembly

## What Is Simulated

Piston kinematics (position, velocity, acceleration), reciprocating inertia force,
gas force on the piston face, side force on the bore, and ring pack friction.

---

## Reciprocating Mass

```
  m_recip = m_piston + m_pin + m_rings + m_con_rod_small_fraction

  m_con_rod_small_fraction = (1/3) × m_con_rod    (standard engineering approximation)
```

The 1/3 factor is derived from assuming the con rod mass is distributed linearly
along its length. For a more accurate value, use the actual centre-of-mass position
of the con rod:

```
  m_recip = m_piston + m_pin + m_rings + m_con_rod × (1 - x_cg/L)

  where x_cg = distance of con rod centre of mass from small end
```

For most rods: x_cg/L ≈ 0.3–0.35 (small end is lighter than big end).

---

## Piston Acceleration

Exact formula (from slider-crank differentiation):

```
  a(θ) = ω² × r × [cosθ + λ(cos2θ - λ³sin⁴θ/...))]
```

Practical second-order approximation (error < 0.5% for λ < 0.35):

```
  a(θ) = ω² × r × (cosθ + λcos2θ)
```

Values at key positions:
```
  a_TDC = +ω²r(1 + λ)    [maximum, upward deceleration]
  a_BDC = -ω²r(1 - λ)    [negative, downward deceleration — smaller than TDC]
```

At 6000 RPM with stroke 86 mm (r = 43 mm), λ = 0.3:
```
  ω = 628 rad/s
  a_TDC = 628² × 0.043 × 1.3 ≈ 21,960 m/s² ≈ 2240 g
  Force on 350g piston: F = 0.35 × 21960 ≈ 7700 N (≈ 770 kgf)
```

---

## Gas Force on Piston

```
  F_gas = (P_cylinder - P_crankcase) × A_piston

  A_piston = π/4 × bore²

  P_crankcase ≈ P_ambient (atmospheric crankcase)
  or P_crankcase from crankcase pressure model (if modelled)
```

The net force the piston transmits to the con rod:

```
  F_net = F_gas - m_recip × a(θ)

  Positive: pushes piston toward crank (power stroke)
  Negative: pulls piston away from crank (inertia dominant)
```

---

## Piston Ring Friction Models

### 1. Simple Coulomb (Constant Friction Coefficient)

```
  F_friction = μ_ring × F_ring_normal × sign(v_piston)

  F_ring_normal = spring_tension + gas_pressure_behind_ring × A_ring_back
```

Very simple, but misses the strong velocity dependence. Overestimates friction
at midstroke, underestimates at TDC/BDC. Accuracy: ±30–50% of instantaneous friction.

### 2. Stribeck-Based Mixed Lubrication Model

The friction coefficient varies with the Stribeck number:

```
  Stribeck number: Str = η × |v_piston| / (p_ring × h_ring)

  where:
    η = oil dynamic viscosity [Pa·s]
    p_ring = mean contact pressure [Pa]
    h_ring = ring face width [m]
```

Friction coefficient from Stribeck curve:

```
  For Str < Str_BL:   μ ≈ μ_BL = 0.08–0.15  (boundary lubrication)
  For Str > Str_EHD:  μ ≈ C/Str              (full hydrodynamic, μ ∝ 1/Str)
  Between:            interpolate             (mixed lubrication)
```

This correctly captures:
- High friction at TDC/BDC (low velocity → boundary regime)
- Low friction at midstroke (high velocity → hydrodynamic)

### 3. Reynolds Equation (Most Accurate, Most Complex)

The Reynolds equation governs the oil film between the ring face and the bore:

```
  d/dx[h³/η × dP/dx] = 6U × dh/dx    (1D Reynolds, steady)

  h = oil film thickness
  U = sliding velocity (piston velocity)
  P = oil film pressure
```

Solving this gives the exact film thickness h(x, θ) and friction force:

```
  F_viscous = ∫ η × U/h dx    (viscous shear)
  F_asperity = f(h/σ) × F_normal    (asperity contact when film is thin)
```

This is what AVL EXCITE Piston&Rings, GT-Suite Ring Module, and Ricardo Piston
use. It resolves cycle-resolved ring friction within ±5–10% of floating liner data.

---

## Ring Friction in Practice (Recommended Model)

For near 1:1 accuracy without full Reynolds solver:

**Two-regime model:**

```
  Near TDC/BDC (|v_piston| < v_transition ≈ 0.5 m/s):
    F_friction = μ_BL × F_normal

  Elsewhere (hydrodynamic):
    F_friction = η × v_piston × A_ring / h_film

  h_film ≈ C × (η × v_piston / p_ring)^0.5    (Greenwood-Tripp)
```

Calibration: fit μ_BL and h_film_reference to floating liner data. With calibration,
accuracy ±10–15% of cycle-resolved friction, ±3–5% of total FMEP.

---

## Thermal Effect on Ring Friction

Oil viscosity drops with temperature (see [13-lubrication.md](../research-simulation/13-lubrication.md)).
At the ring-bore interface:

```
  η(T_ring) = η_ref × exp(B × (1/T_ring - 1/T_ref))

  T_ring ≈ T_wall (cylinder wall temperature from heat transfer model)
```

This coupling between the thermal model and friction model is important for
predicting cold-start fuel consumption (where friction may be 2–3× the warm value).

---

## Accuracy vs Floating Liner Data

| Model | FMEP accuracy (warm, full load) | Crank-resolved accuracy |
|---|---|---|
| Simple Coulomb | ±20–40% | ±40–60% |
| Two-regime Stribeck | ±5–15% | ±15–30% |
| Reynolds equation | ±3–8% | ±8–15% |
| Reynolds + thermal | ±2–5% | ±5–10% |
