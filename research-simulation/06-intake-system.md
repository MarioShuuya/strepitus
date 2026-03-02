# Simulation — Intake System

## What Is Simulated

The intake system determines the mass of fresh charge delivered to the cylinder.
The simulation must capture: throttle pressure drop, manifold filling dynamics,
and runner wave effects on volumetric efficiency.

---

## Throttle Flow Model

### Isentropic Compressible Throttle

The throttle body is modelled as an isentropic orifice:

```
  If P_manifold / P_ambient > Pr_crit (subsonic, typical at part throttle):
    ṁ = Cd × A_throttle × P_amb / √(R × T_amb) × √(γ/(R))
        × (P_man/P_amb)^(1/γ) × √(2γ/(γ-1) × [1 - (P_man/P_amb)^((γ-1)/γ)])

  If P_manifold / P_ambient ≤ Pr_crit (choked, WOT or very closed throttle):
    ṁ = Cd × A_throttle × P_amb / √(R × T_amb) × √(γ) × (2/(γ+1))^((γ+1)/(2(γ-1)))

  Pr_crit = (2/(γ+1))^(γ/(γ-1)) ≈ 0.528
```

### Throttle Area

```
  A_throttle(α) = A_bore × [1 - (D_bore/D_bore)²] × ...

  Simple approximation:
  A_throttle(α) = (π/4) × D_bore² × sin(α)    [butterfly valve]
```

For a circular throttle plate at angle α from closed (0 = fully closed, 90 = fully open):
```
  A_effective(α) = Cd(α) × A_bore × sin(α)
```

Cd(α) should come from measured throttle characterisation. A simple default:
```
  Cd ≈ 0.85 at WOT, drops to ~0.65 near idle (increased turbulence)
```

---

## Manifold Filling-and-Emptying (0D Plenum Model)

The intake manifold is modelled as a 0D volume — uniform pressure and temperature,
updated by the difference between throttle inflow and cylinder outflow.

```
  dP_man/dt = (γ × R × T_man / V_man) × (ṁ_in - ṁ_out)

  ṁ_in  = throttle mass flow rate [kg/s]
  ṁ_out = Σ(ṁ_valve_intake_i) across all cylinders

  T_man = f(T_intake_air, T_walls)    [usually ≈ T_ambient + 5–10°C wall heating]
```

**Why this matters:** without a manifold volume, each cylinder pull (when intake
valve opens) would be instantly communicated to the throttle — unrealistic. The
plenum damps pressure pulsations and provides the buffer.

Time constant of manifold filling:
```
  τ ≈ V_man / (ṁ_throttle / ρ)    [seconds]

  Small plenum (0.5 L): τ ≈ 10–30 ms at idle, < 5 ms at WOT
  Large plenum (2.0 L): τ ≈ 40–120 ms at idle
```

---

## Trapped Air Mass per Cycle

After IVC, the trapped air mass:

```
  m_air = P_manifold(IVC) × V_cylinder(IVC) / (R_air × T_charge)

  T_charge ≈ T_manifest + ΔT_residual_heating

  ΔT_residual ≈ 10–30 K (hot residual gas mixes with fresh charge)
```

### Residual Gas Fraction

Some burned gas remains in the cylinder at the start of each cycle:

```
  x_residual = m_residual / (m_residual + m_fresh)

  m_residual ≈ P_exhaust × Vc / (R_burned × T_exhaust_residual)

  x_residual typical: 5–15% at idle, 3–8% at high load
```

Residuals lower the effective charge density and raise the charge temperature, both
of which reduce volumetric efficiency.

---

## Volumetric Efficiency Model

For a calibrated simulation, ηv is an output that can be compared against the dyno
measurement. The filling model must reproduce the ηv(RPM) curve:

```
  ηv_simulated = m_air_trapped / (ρ_ambient × Vd)
```

For a 0D model without wave dynamics, ηv will be flat or slowly varying with RPM.
To capture the RPM-dependent peak in ηv (from intake resonance), options are:

**Option 1: Empirical ηv(RPM) correction table**
```
  m_air_actual = ηv_table(RPM) × ρ_ambient × Vd
```
Easy to match dyno data — just fit the table. No physics explanation, but excellent
accuracy if the table is measured.

**Option 2: 1D pipe model (GT-Power style)**
Pipes of the correct length and diameter are added between the plenum and each valve.
The Method of Characteristics (or finite volume) solves pressure wave propagation.
This physically predicts ηv(RPM) peaks without curve fitting.
Accuracy: ±2–4% on ηv vs dyno if pipe lengths are correct.

---

## Manifold Pressure vs Throttle (Simplified Steady-State)

For idle and low-RPM modelling, a simplified steady-state relationship:

```
  P_manifold = P_ambient × (α_throttle × (1 - α_min) + α_min)^2

  (Square law approximation for throttle flow coefficient)
```

Where α_min ≈ 0.05 (closed throttle leakage). More accurate: use the full
isentropic throttle equation iterating to steady state.

---

## Accuracy vs Measured Data

| Model | Torque accuracy at WOT | Part-throttle MAP |
|---|---|---|
| Fixed ηv constant | ±10–20% vs RPM | Not modelled |
| Empirical ηv(RPM) table | ±2–4% | ±2% (if separately calibrated) |
| 0D plenum + orifice throttle | ±5–10% | ±3–8% |
| 1D pipe + measured Cd | ±2–4% | ±2–4% |
