# Simulation — Lubrication System

## What Is Simulated

The lubrication model provides: oil viscosity as a function of temperature, journal
bearing friction torque, and optionally oil circuit pressure. The main output is
bearing friction — a contributor to FMEP alongside ring friction.

---

## Oil Viscosity Model

### Walther's Equation

The most accurate and widely used viscosity-temperature model:

```
  log₁₀(log₁₀(η + 0.7)) = A - B × log₁₀(T)

  where:
    η = kinematic viscosity [cSt = mm²/s]
    T = temperature [K]
    A, B = oil-specific constants (fitted to measured viscosity at 40°C and 100°C)

  Fitting procedure:
    Given η(T1) and η(T2) (at T1=313K, T2=373K for SAE measurements):
    B = (log(log(η(T1)+0.7)) - log(log(η(T2)+0.7))) / (log(T2) - log(T1))
    A = log(log(η(T1)+0.7)) + B × log(T1)
```

### Simple Exponential Model

For simulation without measured viscosity data:

```
  η(T) = η_ref × exp(B_vis × (1/T - 1/T_ref))    [mPa·s = cP]

  For SAE 5W-30 (typical):
    η_ref = 11.5 mPa·s at T_ref = 373 K (100°C)
    B_vis ≈ 3500 K

  →  η(333K / 60°C) ≈ 18 mPa·s
  →  η(293K / 20°C) ≈ 60 mPa·s
  →  η(363K / 90°C) ≈ 13 mPa·s    (operating temperature)
```

### Dynamic Viscosity

Convert from kinematic (cSt) to dynamic (mPa·s = cP):

```
  η_dynamic = η_kinematic × ρ_oil / 1000

  ρ_oil(T) ≈ ρ_ref × (1 - α × (T - T_ref))
  ρ_ref ≈ 870 kg/m³, α ≈ 6.5×10⁻⁴ K⁻¹ (typical mineral oil)
```

---

## Journal Bearing Friction (Petroff Equation)

For the main bearings and big-end (rod) bearings in full hydrodynamic lubrication:

```
  τ_bearing = η × ω × π × r_j³ × L_j / c_j    [N·m per bearing]

  where:
    η   = oil dynamic viscosity at bearing temperature [Pa·s]
    ω   = journal angular velocity [rad/s]
    r_j = journal radius [m]
    L_j = bearing width (axial length) [m]
    c_j = radial clearance [m]
```

### Example (Typical Main Bearing)

```
  r_j = 0.028 m (56 mm journal diameter)
  L_j = 0.025 m (25 mm wide)
  c_j = 0.000040 m (40 µm clearance)
  ω   = 628 rad/s (6000 RPM)
  η   = 0.010 Pa·s (SAE 5W-30 at 90°C)

  τ = 0.010 × 628 × π × 0.028³ × 0.025 / 0.000040
    = 0.010 × 628 × π × 2.195×10⁻⁵ × 0.025 / 0.000040
    ≈ 0.27 N·m per main bearing

  5 main bearings: total ≈ 1.35 N·m
  4 rod bearings: similar magnitude → total bearing τ ≈ 2–4 N·m at 6000 RPM
```

---

## Bearing Load (Sommerfeld Number)

The Petroff equation is valid only in full hydrodynamic lubrication. To verify:

```
  Sommerfeld number: S = (η × N × r_j × L_j) / (W × (c_j/r_j)²)

  where:
    N = journal speed [rev/s]
    W = bearing load [N]

  S >> 1: full hydrodynamic (Petroff valid)
  S < 0.1: mixed lubrication (Petroff underestimates friction)
```

For main bearings at operating speed: S > 5 (full hydrodynamic). At startup (ω → 0)
and at low idle: S drops into mixed regime → boundary lubrication, higher friction.

---

## Full Bearing Friction Model

For the most accurate result, include both Petroff viscous torque and boundary
contact friction:

```
  τ_total = τ_Petroff + τ_boundary

  τ_boundary = μ_BL × W × r_j × f(S)    [boundary contribution at low S]

  f(S) = 1 - tanh(S/S_transition)    (smooth transition, S_transition ≈ 0.3)
```

At high RPM, τ_boundary → 0. At startup, τ_boundary dominates.

---

## Oil Circuit Pressure Model

Oil pressure affects:
- VVT phaser response (hydraulically actuated)
- Piston cooling jet activation (typically open above ~1.5 bar)
- Turbo bearing lubrication

Simple model:

```
  P_oil(RPM) = min(P_max_relief, K_pump × RPM)

  P_max_relief = spring-set relief valve pressure ≈ 3.5–6.0 bar
  K_pump ≈ 0.001 bar·min/rev (from pump displacement and line resistance)

  At idle: P_oil ≈ 1.0–2.0 bar
  At 3000 RPM: P_oil ≈ 3.5–5.0 bar (at relief valve)
```

---

## Thermal Coupling

The oil temperature couples the lubrication model to the thermal model:

```
  C_oil × dT_oil/dt = Q̇_friction + Q̇_piston_cooling - Q̇_oil_cooler

  Q̇_friction = τ_bearing × ω + F_ring_friction × |v_piston|    [W from friction heating]
  Q̇_piston_cooling = if(P_oil > P_jet_threshold): flow_jet × Cp_oil × (T_piston - T_oil)
  Q̇_oil_cooler = h_cooler × A_cooler × (T_oil - T_coolant)
```

---

## Accuracy vs Measured Data

| Quantity | Petroff model | Full bearing model |
|---|---|---|
| Bearing FMEP contribution | ±15–25% | ±8–15% |
| Cold-start bearing friction | ×3–5 error (viscosity model matters most) | ±20–40% with viscosity model |
| Oil pressure | ±10–20% (pump model) | — |
| Total FMEP from bearing + rings | ±5–10% (calibrated) | ±3–7% |
