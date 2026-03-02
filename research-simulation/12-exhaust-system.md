# Simulation — Exhaust System

## What Is Simulated

The exhaust system simulation models: blowdown from the cylinder, gas flow through
the exhaust valve, exhaust manifold back-pressure, and optionally 1D wave dynamics
in the exhaust pipes.

---

## Blowdown Model

When the exhaust valve opens (EVO), the cylinder pressure is significantly above
exhaust pressure. The blowdown is modelled as isentropic orifice flow — the same
Barré de Saint-Venant equation used for intake valves, but with reversed pressure gradient:

```
  At EVO: P_cylinder >> P_exhaust
  Flow: cylinder → exhaust (high pressure to low)

  If P_cylinder / P_exhaust > Pr_crit (≈ 1.89 for γ = 1.35): choked (sonic)
    ṁ_exhaust = Cd × A_valve(L_EV) × P_cyl / √(R × T_cyl) × √γ × (2/(γ+1))^((γ+1)/(2(γ-1)))

  Else: subsonic flow (Barré de Saint-Venant)
```

This correctly models the high-pressure pulse that occurs at EVO and carries
thermal energy and acoustic content out of the cylinder.

---

## Exhaust Manifold (0D Back-Pressure Model)

Simplest approach: constant back-pressure equal to a fixed multiple of ambient:

```
  P_exhaust = P_ambient + ΔP_backpressure

  ΔP_backpressure: 0 (free-flow) to ~20 kPa (restrictive stock exhaust at WOT)
```

This is adequate for predicting average torque and BSFC at WOT. It misses:
- Pressure wave effects that help scavenging at high RPM
- Transient back-pressure variation at low RPM

### Semi-Empirical Back-Pressure Model

```
  P_exhaust(RPM, load) = P_ambient × (1 + K_exhaust × (RPM/RPM_ref)^2)

  K_exhaust ≈ 0.01–0.05 (from measured data)
```

---

## 1D Pipe Wave Propagation (Method of Characteristics)

For near 1:1 accuracy, especially on volumetric efficiency vs RPM curves, the exhaust
must be modelled as a 1D compressible flow system. This is how GT-Power, AVL BOOST,
and Ricardo WAVE work.

### Method of Characteristics (MoC)

The 1D Euler equations for compressible pipe flow:

```
  Continuity:  ∂ρ/∂t + ∂(ρu)/∂x = 0
  Momentum:    ∂(ρu)/∂t + ∂(ρu² + P)/∂x = -f × ρu|u|/(2D)    (friction)
  Energy:      ∂E/∂t + ∂((E+P)u)/∂x = q̇ × ρ / A              (wall heat)
```

Along the characteristic lines (Riemann invariants):

```
  Forward characteristic (speed u + a):  J+ = u + 2a/(γ-1) = const
  Backward characteristic (speed u - a): J- = u - 2a/(γ-1) = const

  a = speed of sound = √(γRT)
  u = flow velocity

  Pressure: P = P_ref × ((J+ - J-)×(γ-1)/4)^(2γ/(γ-1)) × (a_ref/P_ref^((γ-1)/2γ))^...
```

The characteristic lines advance at (u ± a) — faster than the bulk flow for acoustic waves.

### Finite Volume (GT-Power approach)

GT-Power discretises each pipe into subvolumes (typically 1–3 cm long). At each
timestep, mass, momentum, and energy are exchanged between adjacent subvolumes:

```
  m_vol, P_vol, T_vol evolve with each timestep
  Timestep constrained by: Δt < Δx / (u + a)    (CFL condition)
```

For a 0.5 m exhaust primary with 2 cm subvolumes: 25 volumes per pipe, 4 pipes = 100 volumes.
Each volume has 3 state variables → 300 ODEs per exhaust system. Fast to solve, even in WASM.

---

## Exhaust Scavenging Effect

With a 1D exhaust model, the negative pressure reflection pulse automatically appears
as a suction at the exhaust valve during the overlap period:

```
  P_exhaust_at_valve(θ) = output of 1D pipe model at the valve end
  If P_exhaust_at_valve < P_intake_at_valve: net flow from intake to exhaust → scavenging
```

Without 1D pipes, scavenging can be approximated by a volumetric efficiency
correction factor at each RPM (empirical ηv table, see [06-intake-system.md](06-intake-system.md)).

---

## EGT Simulation

Exhaust gas temperature at EVO is the cylinder gas temperature at that moment:

```
  T_EGT_simulated = T_gas(EVO)    [from thermodynamic model]

  This is the temperature just as the valve opens. The actual thermocouple reading
  will be lower because:
    - Gas cools as it flows through the exhaust port and pipe (~50–150 K drop by sensor)
    - Thermocouple lag (~5–20°C at steady state)

  Approximate correction:
  T_thermocouple ≈ T_EGT - ΔT_pipe_cooling - ΔT_sensor_lag

  ΔT_pipe_cooling ≈ 50–100 K per 100 mm of pipe (at typical exhaust temperatures)
```

---

## Acoustic Output (Exhaust Note)

The pressure at the tailpipe exit is the acoustic source for exhaust noise simulation:

```
  P_acoustic(t) = P_tailpipe(t) - P_ambient    [fluctuating component]

  Fundamental frequency: f = N_cylinders × RPM / (2 × 60)

  The spectrum of P_acoustic contains: f, 2f, 3f, ... and their beat frequencies
  from multi-cylinder engines with uneven spacing
```

For audio synthesis, it is sufficient to drive the synthesiser with:
- The firing frequency (from RPM and cylinder count)
- The blowdown pulse intensity per cylinder (from P_cylinder(EVO) / P_exhaust)
- EGT (affects tone character)

---

## Accuracy vs Measured Data

| Model | ηv accuracy vs dyno | EGT accuracy | Torque accuracy WOT |
|---|---|---|---|
| Constant back-pressure | ±8–15% (RPM shape wrong) | ±50–100 K | ±5–10% |
| Semi-empirical ΔP(RPM) | ±5–8% | ±30–60 K | ±3–6% |
| 1D MoC (calibrated) | ±2–4% | ±15–30 K | ±1–3% |
| 1D FV GT-Power style | ±1–3% | ±10–20 K | ±1–2% |
