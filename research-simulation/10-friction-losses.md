# Simulation — Friction Losses

## What Is Simulated

Friction removes energy from the crankshaft. An accurate friction model is essential
for matching simulated BSFC, brake power, and brake torque to measured values.

---

## Chen-Flynn FMEP Model (Industry Standard)

The Chen-Flynn correlation is the standard friction model in GT-Power, AVL BOOST,
and Ricardo WAVE:

```
  FMEP = A + B × P_max + C × v_mean + D × v_mean²    [Pa]

  where:
    A     = constant friction [Pa] (boundary lubrication, ring sealing load)
    B     = coefficient on peak cylinder pressure [—] (gas-loading dependent friction)
    C     = coefficient on mean piston speed [Pa·s/m] (viscous friction)
    D     = coefficient on mean piston speed squared [Pa·s²/m²] (windage)
    P_max = peak cylinder pressure [Pa]
    v_mean = 2 × stroke × RPM/60 [m/s]
```

### Typical Constants (Naturally Aspirated Gasoline Engine)

Calibrated to measured FMEP data:

```
  A ≈ 40,000–80,000 Pa     (idle friction floor)
  B ≈ 0.005–0.010          (small — gas loading effect on rings)
  C ≈ 4,000–8,000 Pa·s/m   (viscous, dominant at mid RPM)
  D ≈ 100–300 Pa·s²/m²     (windage, dominant at high RPM)
```

**Usage:**

```
  FMEP → friction torque loss:
  τ_friction = FMEP × Vd / (2π × n_strokes)    [N·m]

  Or: subtract FMEP from IMEP to get BMEP
```

### Limitation

Chen-Flynn gives total FMEP but not the crank-angle-resolved friction force. This
is adequate for torque and BSFC calculations. For crank-resolved analysis (P-V
diagram accuracy), a per-step friction force is needed (see piston assembly model).

---

## Per-Step Ring Friction Model

For crank-angle resolved simulation:

```
  F_friction(θ) = F_coulomb(θ) + F_viscous(θ)

  F_coulomb(θ) = μ_ring × F_ring_normal(θ) × sign(v_piston)

  F_ring_normal(θ) = F_spring_tension + P_cyl(θ) × A_ring_back_face

  F_viscous(θ) = η(T_wall) × |v_piston(θ)| × A_contact / h_film
```

### Ring Normal Force (Gas Loading)

The cylinder pressure acts on the back of the top compression ring, increasing the
radial contact force during the compression and power strokes:

```
  F_ring_normal_total = F_ring_spring + P_cyl × A_ring_width × 2πr_bore

  This is why high-compression and high-boost engines have higher ring friction
```

### Viscous Component

```
  h_film ≈ C_film × √(η × |v_piston| / p_ring_mean)

  h_film_typical ≈ 0.5–5 µm at midstroke
  η ≈ 5–15 mPa·s at 90°C operating temperature

  F_viscous = η × v_piston × A_contact / h_film
```

---

## Viscosity-Temperature Model

Oil viscosity is the coupling between the thermal model and friction:

```
  η(T) = η_ref × exp(B_vis × (1/T - 1/T_ref))    [Pa·s]

  For SAE 5W-30 at 90°C: η_ref ≈ 10 mPa·s
  B_vis ≈ 3000–4000 K    (from viscosity measurements at two temperatures)

  Or using Walther's equation:
  log₁₀(log₁₀(η + 0.7)) = A - B × log₁₀(T)
```

This is important for cold-start friction prediction. Without the temperature
dependence, the simulation will drastically underestimate cold-start fuel consumption.

---

## Bearing Friction (Petroff, Simplified)

For the main and rod bearings (hydrodynamic operation):

```
  τ_bearing = η(T) × ω × π × r³ × L / c

  For all main bearings:
  τ_mains = n_mains × η × ω × π × r_main³ × L_main / c_main

  For all rod bearings (big ends):
  τ_rods = n_rods × η × ω_relative × π × r_rod³ × L_rod / c_rod
```

Total bearing friction torque is small relative to ring friction but becomes dominant
at very high RPM (increases with ω).

---

## Pumping FMEP

Pumping losses during gas exchange strokes:

```
  PMEP = P_exhaust - P_intake    (simplified, for fully efficient gas exchange)

  More accurately: compute from P-V diagram during intake and exhaust strokes

  At idle (throttled): PMEP ≈ 30–80 kPa
  At WOT: PMEP ≈ 5–15 kPa (small, only residual flow resistance)
```

---

## Accessory Losses (Constant Torque Offset)

```
  τ_accessories = τ_oil_pump + τ_water_pump + τ_alternator

  Simple model: τ_accessories = constant [N·m] at all RPMs
  Better model: τ_accessories = a + b × RPM²    (centrifugal pumps: power ∝ RPM³)
```

---

## Total Friction Budget

At 3000 RPM, warmed up, naturally aspirated, WOT:

| Source | FMEP contribution [kPa] |
|---|---|
| Ring pack | 45–60 |
| Crankshaft bearings | 15–25 |
| Valve train | 10–20 |
| Pumps and accessories | 8–15 |
| Windage | 3–8 |
| **Total FMEP** | **80–130** |

---

## Accuracy vs Measured FMEP

| Model | FMEP accuracy (warm engine) | BSFC impact |
|---|---|---|
| Simple constant FMEP | ±20–40% across RPM range | ±3–8% BSFC |
| Chen-Flynn (calibrated) | ±3–8% | ±1–3% BSFC |
| Chen-Flynn + viscosity coupling | ±3–6% (cold and warm) | ±1–2% BSFC |
| Full ring model + Petroff bearings | ±5–10% (crank resolved) | ±1–3% BSFC |

The Chen-Flynn model with measured constants is the best practical choice for achieving
near 1:1 accuracy on brake power and BSFC.
