# Simulation — Connecting Rod

## What Is Simulated

The connecting rod is the kinematic link between the piston and crankshaft. In a
0D simulation it is not modelled as a body — only its kinematic effect matters:
converting linear piston motion to rotary crankshaft motion, and splitting its mass
between reciprocating and rotating fractions.

---

## Slider-Crank Kinematics

The complete kinematic chain:

```
  Inputs:  θ (crank angle), ω = dθ/dt, r = S/2, L (con rod length)
  Outputs: x(θ), v(θ), a(θ), β(θ)

  Lambda:  λ = r / L    (crank-to-rod ratio, typically 0.27–0.35)
```

### Position

```
  x(θ) = r(1 - cosθ) + L - √(L² - r²sin²θ)
```

### Velocity

```
  v(θ) = ω × r × [sinθ + (λsinθcosθ) / √(1 - λ²sin²θ)]
```

Approximate (second-order):

```
  v(θ) ≈ ω × r × [sinθ + (λ/2)sin2θ]
```

### Acceleration

Exact:

```
  a(θ) = ω² × r × [cosθ + λ(cos2θ - λ²sin⁴θ) / (1 - λ²sin²θ)^(3/2)]
```

Approximate:

```
  a(θ) ≈ ω² × r × (cosθ + λcos2θ)
```

The approximate formula is used in almost all 0D simulation codes. Error < 1% for
λ < 0.35.

### Con Rod Angle

```
  sinβ = λsinθ    →    β = arcsin(λsinθ)
```

Maximum angle: β_max = arcsin(λ) ≈ 16.7° for λ = 0.288.

---

## Force-to-Torque Conversion

The net piston force (gas + inertia) acts along the cylinder axis. Converting to
crankshaft torque via the exact lever arm formula:

```
  τ = F_piston × r × sin(θ + β) / cosβ

  where:
    F_piston = F_gas + F_inertia = (P_cyl - P_amb) × A_piston - m_recip × a(θ)
    β = arcsin(λsinθ)
```

This is the exact formula for a rigid slider-crank. It correctly handles the
effective moment arm variation throughout the cycle.

### Torque at Key Positions

```
  At θ = 90° (midstroke, maximum torque for given F_piston):
    β = arcsin(λ) ≈ 17°
    τ = F × r × sin(90° + 17°) / cos(17°) = F × r × sin(107°)/cos(17°) ≈ F × r × 0.987

  At TDC (θ = 0°) and BDC (θ = 180°):
    β = 0, sin(θ) = 0 → τ = 0 (dead centre — no torque regardless of force)
```

---

## Mass Splitting

The con rod mass is split into two parts for the equations of motion:

```
  m_rotating = m_con_rod × (x_cg / L)     [big end fraction, rotates with crank]
  m_recip_rod = m_con_rod × (1 - x_cg / L)  [small end fraction, reciprocates]

  Default approximation (x_cg/L = 2/3):
    m_rotating ≈ (2/3) × m_con_rod
    m_recip_rod ≈ (1/3) × m_con_rod
```

**Total reciprocating mass:**
```
  m_recip = m_piston + m_pin + m_rings + (1/3) × m_con_rod
```

**Total rotating mass (adds to crankshaft inertia):**
```
  I_rod_rotating = (2/3) × m_con_rod × r²    (added to crankshaft J)
```

---

## Con Rod Flexibility (Advanced)

A rigid rod is the standard 0D assumption. For high-precision simulation:

The rod bends under lateral (side) force, and the big end stretches under tension.
This affects:
- Bearing clearance (affects hydrodynamic film)
- TDC position (affects true compression ratio)
- Vibration modes

GT-Suite's crankshaft module includes elastic rod bodies (FEA-based). For our
purposes, the rigid assumption introduces < 0.1% error in torque and < 0.5% in
bearing load.

---

## Accuracy vs Measured Data

| Quantity | Model | vs strain gauge measurement |
|---|---|---|
| Axial force F(θ) | Rigid slider-crank | ±3–5% |
| Torque τ(θ) | Exact lever arm formula | ±2–4% (dominated by pressure uncertainty) |
| Mass split | 1/3 approximation | ±2–5% vs measured x_cg |

The dominant uncertainty is the cylinder pressure accuracy, not the kinematic model.
A ±0.3 bar pressure uncertainty at peak pressure (100 bar) gives ±3 kN on F_gas,
which translates directly to ±3% torque error.
