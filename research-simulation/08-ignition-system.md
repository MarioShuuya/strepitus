# Simulation — Ignition System

## What Is Simulated

The ignition system simulation controls the start of combustion (spark timing) and
optionally models knock. The spark timing directly sets CA50, peak pressure location,
and IMEP — it is the most sensitive single parameter for combustion output accuracy.

---

## Spark Timing Model

The spark fires at crank angle θ_spark (degrees before TDC, specified as BTDC):

```
  θ_combustion_start = 360° - θ_spark_advance    [in 720° 4-stroke cycle convention]
```

In the simulation, this is the point at which the Wiebe function begins
accumulating heat release. No actual plasma physics is modelled — the spark is
treated as an instantaneous ignition trigger.

### Ignition Map

At different operating points, the spark advance is read from a 2D table:

```
  θ_spark(RPM, load) = lookup(RPM, MAP)    [degrees BTDC]

  load = MAP / MAP_WOT    or    IMEP    or    throttle position

  Table populated from MBT sweep data (see testing file)
```

---

## Wiebe Combustion Model

The Wiebe function is the industry-standard model for heat release rate in spark-ignition
engines. It models the cumulative mass fraction burned as a function of crank angle:

```
  x_b(θ) = 1 - exp[-a × ((θ - θ_0) / Δθ)^(m+1)]

  where:
    θ_0  = start of combustion (≈ spark angle)
    Δθ   = combustion duration [degrees]
    a    = efficiency parameter (standard: a = 5.0, gives ~1% unburned at θ = θ_0 + Δθ)
    m    = shape parameter (standard: m = 2.0, gives the S-curve shape)
```

Rate of heat release:

```
  dx_b/dθ = (a×(m+1)/Δθ) × ((θ-θ_0)/Δθ)^m × exp[-a×((θ-θ_0)/Δθ)^(m+1)]

  dQ/dθ = Q_total × dx_b/dθ    [J/°]
```

### Wiebe Parameter Calibration

The parameters a, m, Δθ must be fitted to measured combustion analysis data:

```
  Target: match simulated CA50 to measured CA50 ± 1°
          match burn duration (CA10–CA90) to measured ± 2°

  Procedure:
    1. Run engine at target operating point
    2. Record P(θ) → compute measured x_b(θ) via 1st law
    3. Fit Wiebe parameters (a, m, Δθ, θ_0) to minimise error in x_b(θ)
```

Typical calibrated values for a naturally aspirated gasoline engine:
```
  a = 5.0 (fixed — mathematically well-defined)
  m = 1.5–2.5 (lower = faster initial burn, higher = slower initial burn)
  Δθ = 30°–60° at low RPM, 50°–80° at high RPM
```

### RPM-Dependent Combustion Duration

Combustion takes roughly constant time in seconds. At higher RPM, the same time
corresponds to more crank degrees:

```
  Δθ(RPM) = Δθ_ref × (RPM / RPM_ref)^n

  n ≈ 0.3–0.5 empirically (sub-linear because flame speed also increases)

  Or use a lookup table fitted to measured CA10–CA90 at each RPM
```

---

## Knock Model

### Arrhenius Ignition Delay (Livengood-Wu Integral)

The most physically based knock model tracks the autoignition progress of the end gas
using an Arrhenius-type induction time correlation:

```
  τ_ign(P, T) = A × P^(-n) × exp(B/T)

  where:
    A, B, n = fuel-specific empirical constants
    For gasoline RON95: A ≈ 17.68, n ≈ 1.7, B ≈ 3800 K (Douaud-Eyzat)

  Knock occurs when: ∫ dt / τ_ign(P(t), T(t)) = 1    (Livengood-Wu integral)
```

Procedure at each crank step:
```
  I += Δt / τ_ign(P_end_gas, T_end_gas)
  If I ≥ 1: knock occurs at this crank angle
```

End gas temperature T_end_gas is approximated as the isentropic temperature of the
unburned portion:
```
  T_end_gas(θ) = T_IVC × (P(θ) / P_IVC)^((γ-1)/γ)
```

**Calibration:** A, B, n are calibrated to measured KLSA data (sweep advance until knock
onset at known P-T conditions). With calibration: knock onset predicted within ±2–3°.

### Simple Threshold Model (Alternative)

Without Arrhenius integration:
```
  Knock risk = 1 if T_end_gas_at_TDC > T_knock_threshold(fuel_octane)
  T_knock_threshold ≈ 700–900 K depending on fuel and pressure

  If knock: retard spark by Δθ_retard (1–4°) per cycle
```

Less accurate but easy to implement. Gives the right qualitative behaviour without
fuel property data.

---

## CA50 Optimisation (MBT Seeking)

A simulation can include an automatic MBT-seeking algorithm:

```
  dτ/dθ_spark ≈ 0 at MBT
  Binary search: test two spark advances, pick the one with higher torque
  Converges in ~10 iterations to within ±0.5° of MBT
```

This allows the simulation to automatically find MBT across the map.

---

## Accuracy vs Measured Data

| Quantity | Wiebe (calibrated) | Wiebe (default params) |
|---|---|---|
| CA50 location | ±1–2° | ±3–8° |
| Peak pressure magnitude | ±2–5 bar | ±5–15 bar |
| Peak pressure location | ±1–2° | ±3–6° |
| IMEP | ±2–4% | ±5–10% |
| Knock onset | ±2–3° (Arrhenius, calibrated) | Not modelled |

The Wiebe model is accurate enough for a full thermodynamic simulation. The key is
calibrating Δθ and m from measured combustion analysis data — without this, errors
of 10% in IMEP are common.
