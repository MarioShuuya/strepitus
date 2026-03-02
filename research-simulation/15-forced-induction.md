# Simulation — Forced Induction

## What Is Simulated

The forced induction model computes: compressor outlet pressure and temperature (boost),
turbine power extraction, wastegate control, intercooler cooling, and turbocharger
shaft dynamics (spool-up and lag).

---

## Turbocharger Shaft Dynamics

The turbocharger rotor is a rotating mass driven by the turbine and loading the compressor:

```
  J_turbo × dω_turbo/dt = τ_turbine - τ_compressor - τ_bearing_loss

  τ_turbine = P_turbine / ω_turbo
  τ_compressor = P_compressor / ω_turbo
```

Turbocharger inertia is very small but the rotational speed is very high:

```
  J_turbo ≈ 1×10⁻⁵ to 5×10⁻⁵ kg·m²   (tiny rotor, very light)
  ω_turbo ≈ 100,000–300,000 RPM = 10,000–31,400 rad/s
```

Typical spool-up time constant:

```
  τ_spool = J_turbo × ω_turbo / τ_net

  With 5 N·m net torque: τ_spool ≈ 5×10⁻⁵ × 20,000 / 5 ≈ 0.2 s

  But: τ_net is small until engine RPM is high enough → effective lag is longer
```

---

## Compressor Model (Map Interpolation)

The compressor operating point is determined by the intersection of:
- The engine demand curve (what flow rate and pressure ratio the engine needs)
- The compressor map (what PR the compressor produces at a given flow and speed)

### Map Lookup

Given compressor speed N_c and mass flow ṁ_corrected:

```
  ṁ_corrected = ṁ × √(T_inlet/T_ref) / (P_inlet/P_ref)    [corrected mass flow]
  N_corrected = N_c / √(T_inlet/T_ref)                      [corrected speed]

  PR = f(N_corrected, ṁ_corrected)          [2D map lookup]
  η_c = g(N_corrected, ṁ_corrected)         [2D map lookup]
```

### Compressor Outlet Conditions

```
  T2 = T1 × (1 + (PR^((γ-1)/γ) - 1) / η_c)    [isentropic + efficiency]
  P2 = PR × P1

  Compressor power:
  P_comp = ṁ × Cp × (T2 - T1) = ṁ × Cp × T1 × (PR^((γ-1)/γ) - 1) / η_c
```

---

## Turbine Model (Map Interpolation)

Similarly, the turbine map gives efficiency and expansion ratio:

```
  ṁ_corrected_turbine = ṁ_exhaust × √T3 / P3
  PR_turbine = P3 / P4    (exhaust manifold / atmospheric)

  η_t = h(PR_turbine, N_corrected)    [from turbine map]

  T4 = T3 × (1 - η_t × (1 - PR_turbine^(-(γ-1)/γ)))    [turbine outlet temp]
  P_turbine = ṁ_exhaust × Cp × (T3 - T4)
```

### Energy Balance at Steady State

```
  P_turbine = P_compressor + P_bearing_loss

  At steady state dω/dt = 0, so this equality must hold.
  The operating point is where the turbine and compressor power curves cross.
```

---

## Simplified Turbo Model (Without Full Maps)

If compressor and turbine maps are unavailable, a simplified model:

```
  boost_target = user-defined [Pa above ambient]
  η_c_assumed = 0.72    (typical peak efficiency)

  T2 = T1 × (1 + (PR^((γ-1)/γ) - 1) / η_c_assumed)
  P_manifold = boost_target + P_ambient    (or use first-order lag for transient)
```

First-order lag for spool-up:

```
  dP_boost/dt = (P_boost_target - P_boost_actual) / τ_spool

  τ_spool = J_turbo × ω_rated / P_turbine_rated    [approximation]

  Typical: τ_spool ≈ 0.5–2.0 s
```

---

## Wastegate Control

PID controller on boost pressure:

```
  error = P_boost_target - P_boost_actual
  WG_duty = K_p × error + K_i × ∫error dt + K_d × d(error)/dt

  WG_duty → effective wastegate area A_WG(duty)
  A_WG: fraction of exhaust bypassing turbine

  ṁ_turbine = ṁ_exhaust × (1 - WG_duty × A_WG_max / A_WG_total)
```

At steady state: WG_duty adjusts until P_boost = P_boost_target.

---

## Intercooler Model

```
  T_after_intercooler = T2 - ε × (T2 - T_ambient)

  ε = intercooler effectiveness (0.70–0.85)

  Charge density gain from intercooling:
  ρ_charge = P2 / (R_air × T_after_intercooler)

  Gain vs no intercooler:
  ρ_gain = T2 / T_after_intercooler    (e.g. 370 K / 320 K = 15.6% more dense)
```

Intercooler pressure drop:

```
  P_after_intercooler = P2 - ΔP_IC

  ΔP_IC ≈ K_IC × ṁ²    (quadratic with flow)
  K_IC fitted from measured pressure drop data
```

---

## Accuracy vs Measured Boost Curve

| Model | Boost vs RPM accuracy | Spool-up accuracy | T_outlet accuracy |
|---|---|---|---|
| Simplified (fixed boost) | Not applicable (imposed) | Not modelled | ±10–20 K |
| First-order lag | ±0.1 bar (steady), poor transient shape | Rough ±0.5–1 s | ±10–20 K |
| Map interpolation + ODE | ±0.05 bar | ±0.2–0.5 s | ±5–15 K |
