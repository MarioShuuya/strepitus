# Simulation — Combustion Chamber

## What Is Simulated

The combustion chamber geometry functions: instantaneous volume V(θ), piston position
x(θ), and combustion surface area A(θ). These are purely geometric — no empiricism
required. They are the foundation on which all thermodynamic calculations are built.

---

## Piston Position

The exact slider-crank formula:

```
  x(θ) = r(1 - cosθ) + L - √(L² - r²sin²θ)

  r = S/2    (crank throw)
  L = con rod length
  θ = crank angle from TDC (0 at TDC, π at BDC)
```

Second-order approximation (error < 0.3% for λ = r/L < 0.35):

```
  x(θ) ≈ r[(1 - cosθ) + (λ/2)(1 - cos2θ)]
```

Use the exact formula in simulation — it has negligible compute cost and eliminates
any approximation error from geometry.

---

## Instantaneous Cylinder Volume

```
  V(θ) = Vc + A_piston × x(θ)

  Vc = Vd / (CR - 1)
  A_piston = π/4 × bore²
  Vd = A_piston × stroke
```

Rate of volume change (needed for work and heat release calculations):

```
  dV/dθ = A_piston × dx/dθ

  dx/dθ = r × sinθ × (1 + λcosθ / √(1 - λ²sin²θ))
```

Or from the exact formula:
```
  dx/dθ = r × sinθ + r²sinθcosθ / √(L² - r²sin²θ)
```

---

## Combustion Surface Area

Heat transfer requires the instantaneous exposed surface area:

```
  A_combustion(θ) = A_piston_crown + A_cylinder_head + A_bore_exposed

  A_bore_exposed = π × bore × x(θ)

  Typical total:
  At TDC: ~0.005–0.015 m² (just head + piston, small bore exposed)
  At BDC: ~0.015–0.040 m² (full bore height exposed)
```

For a simplified model, A can be approximated as:

```
  A(θ) = 2 × A_piston + π × bore × x(θ)
```

(Assumes flat head and piston crown — underestimates by ~10% due to actual chamber shape.)

---

## Compression Ratio and Clearance Volume

```
  CR = (Vd + Vc) / Vc    →    Vc = Vd / (CR - 1)

  V_max = Vd + Vc    (at BDC)
  V_min = Vc          (at TDC)
```

The compression ratio is one of the most sensitive parameters in the simulation.
A CR error of ±0.5 causes:
- IMEP error: ~±3–5%
- Peak pressure error: ~±5–8%
- Thermal efficiency error: ~±1–2%

Ensure CR is measured accurately (see testing file) and not just read from specs.

---

## Effective Compression Ratio

If the intake valve closes after BDC (IVC > 180°), the effective compression ratio
is lower than the geometric CR:

```
  CR_eff = V(IVC) / V_min = V(IVC) / Vc

  where V(IVC) is the cylinder volume at the moment the intake valve closes
```

For a typical IVC of 40° ABDC, CR_eff / CR_geometric ≈ 0.92–0.96 at low RPM.
This directly affects the trapped charge mass and the peak compression pressure.

---

## Trapped Air Mass

The mass of air trapped in the cylinder at IVC:

```
  m_air = P_IVC × V(IVC) / (R_air × T_IVC)

  P_IVC ≈ manifold pressure (approximately — ignores flow dynamics)
  T_IVC ≈ mixture temperature at intake valve close
```

A more accurate model accounts for:
- Residual gas fraction (burned gas remaining from previous cycle)
- Heat transfer from hot port walls warming the incoming charge
- Valve flow dynamics (the pressure inside the cylinder at IVC may differ from
  manifold pressure by ±5–15% depending on valve timing and RPM)

---

## Accuracy vs Real World

| Quantity | Model error (exact formula) | Model error (approx formula) |
|---|---|---|
| Volume V(θ) | < 0.01% | < 0.3% for λ < 0.35 |
| dV/dθ | < 0.01% | < 0.5% |
| x(θ) | < 0.01% | < 0.3% |
| A(θ) | ~5–10% (simple model) | — |

The geometry itself is essentially exact. Volume error < 0.01% means the geometry
is never the source of simulation inaccuracy — other models (combustion, heat transfer)
dominate.

---

## Implementation Notes

```rust
// Exact formula (preferred)
fn piston_position(crank_angle: f64, r: f64, l: f64) -> f64 {
    r * (1.0 - crank_angle.cos()) + l - (l*l - r*r * crank_angle.sin().powi(2)).sqrt()
}

fn cylinder_volume(crank_angle: f64, config: &EngineConfig) -> f64 {
    let r = config.stroke / 2.0;
    let x = piston_position(crank_angle, r, config.con_rod_length);
    let a_piston = PI / 4.0 * config.bore.powi(2);
    let vc = a_piston * config.stroke / (config.compression_ratio - 1.0);
    vc + a_piston * x
}

fn dv_dtheta(crank_angle: f64, config: &EngineConfig) -> f64 {
    let r = config.stroke / 2.0;
    let l = config.con_rod_length;
    let sin = crank_angle.sin();
    let cos = crank_angle.cos();
    let a_piston = PI / 4.0 * config.bore.powi(2);
    let dx = r * sin + r*r * sin * cos / (l*l - r*r * sin.powi(2)).sqrt();
    a_piston * dx
}
```
