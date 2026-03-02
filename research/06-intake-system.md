# Intake System

## What It Is

The intake system delivers fresh air (or air-fuel mixture in older carburetted engines)
to the cylinders. Its design directly determines how much charge mass enters the
cylinder and therefore how much power the engine can produce. Every restriction and
pressure drop in the intake path reduces volumetric efficiency.

---

## System Overview

```mermaid
graph LR
  ATM["Atmosphere"] --> FILTER["Air Filter: removes particles"]
  FILTER --> MAF["Mass Airflow Sensor: measures flow rate"]
  MAF --> TB["Throttle Body: controls airflow"]
  TB --> PLENUM["Intake Plenum: pressure reservoir"]
  PLENUM --> RUNNER["Intake Runner: individual tuned pipe"]
  RUNNER --> PORT["Intake Port: in cylinder head"]
  PORT --> IV["Intake Valve"]
  IV --> CYL["Cylinder"]
```

---

## Air Filter

Removes particles (dust, pollen, insects) before they enter the engine. Damage from
ingested particles causes rapid bore and ring wear.

- **Paper element** — most common. Replaced every 15,000–30,000 km.
- **Oiled cotton gauze (K&N style)** — reusable, slightly higher flow, must be re-oiled.
- **Cold air intake** — routes filter to a cooler location; denser cold air improves power.

Pressure drop across a clogged filter can reduce volumetric efficiency significantly.
A typical clean filter pressure drop: ~0.5–2 kPa at full load.

---

## Throttle Body

The throttle body contains a butterfly valve (throttle plate) that rotates to control
airflow into the engine. It is the primary load control mechanism for a gasoline engine.

```
  A_throttle(α) = A_bore × sin(α)    (approximate for a butterfly valve)

  where α = throttle angle (0° = fully closed, 90° = fully open)
```

### Isentropic Throttle Flow

When the pressure ratio across the throttle exceeds the critical ratio (~0.528 for air),
flow becomes choked (sonic). Below the critical ratio:

```
  ṁ = Cd × A_throttle × P0 / √(T0) × √(2γ/(γ-1) × R × [(P2/P0)^(2/γ) - (P2/P0)^((γ+1)/γ)])

  where:
    P0 = upstream stagnation pressure (atmospheric)
    P2 = downstream pressure (manifold)
    Cd = discharge coefficient (~0.7–0.9 for a butterfly valve)
    T0 = upstream temperature
```

In practice, many simulations use a simplified square-root throttle model:
```
  ṁ ∝ Cd × A_throttle × √(ΔP)
```

### Manifold Vacuum

When the throttle is partially closed, the manifold pressure drops below atmospheric.
This manifold vacuum is used by:
- Brake booster (power brakes)
- EGR systems
- HVAC actuators (older vehicles)
- Oil separator / PCV

At idle, manifold pressure can be 30–70 kPa (vs 101 kPa ambient) — a vacuum of
30–70 kPa or roughly 10–20 inHg.

---

## Intake Manifold and Plenum

The intake manifold distributes air from the throttle body to individual cylinder
runners.

### Plenum
A large volume chamber that damps out the pressure pulsations caused by individual
cylinder intake events. A larger plenum smooths airflow but adds weight and packaging
challenges.

### Intake Runner Length and Diameter

**Runner length** controls the resonant frequency of the intake tract. When the intake
valve opens, a negative pressure wave travels down the runner to the plenum and reflects
as a positive wave. If this positive wave arrives just before the intake valve closes,
it supercharges the cylinder (ram effect):

```
  f_resonance = v_sound / (4 × L_runner)    [Hz, quarter-wave resonance]

  f_resonance = RPM × N_cylinders_sharing / (2 × 60)    [firing frequency]

  Optimal runner length:
  L_runner = (v_sound × 60) / (2 × RPM × N)    [m]

  v_sound ≈ 343 m/s at 20°C, higher when hot
```

Short runners favour high-RPM power (high resonant frequency). Long runners favour
low-RPM torque. Variable-length intake runners (VLIM — Variable Length Intake
Manifold) change runner effective length by opening bypass valves, optimising across
the RPM range.

### Runner Diameter
A smaller diameter accelerates flow, increasing charge velocity (helps at low RPM).
A larger diameter reduces restriction at high RPM. The diameter must match the intake
port cross-section for smooth transition.

---

## Intake Port

The port in the cylinder head between the runner and the valve seat. Its design
controls:

- **Swirl** — rotation of charge about the cylinder axis (horizontal tumble axis).
  Improves mixture formation in direct injection diesels.
- **Tumble** — rotation about the cylinder axis perpendicular to the crankshaft.
  Promotes mixing in gasoline engines, breaks down to turbulence near TDC.
- **Flow velocity** — must be high enough to atomise fuel (port injection) but not
  so high that it creates excessive pressure drop.

Port polishing (smoothing the surface) increases flow marginally; the benefit is
often overstated. Port shape is far more important than surface finish.

---

## Volumetric Efficiency

The key metric for the entire intake system:

```
  ηv = m_air_actual / m_air_theoretical

  m_air_theoretical = ρ_ambient × Vd_single

  ρ_ambient = P_ambient / (R_air × T_ambient)
```

### ηv vs RPM Curve

A typical NA engine ηv curve:
```
  Low RPM:   ηv ~70–80%   (slow charge velocity, poor ram effect)
  Peak RPM:  ηv ~95–105%  (resonance aligns, maximum filling)
  High RPM:  ηv falls     (valve flow area insufficient, back-pressure from exhaust)
```

The peak of ηv corresponds to the torque peak RPM.

### Factors Reducing ηv

| Factor | Mechanism |
|---|---|
| Throttle restriction | Lower manifold pressure → less charge density |
| Late IVO or early IVC | Less time for charge to enter |
| Intake restriction | Filter, TB, port pressure drop |
| High charge temperature | Lower density |
| Residual burned gas | Less volume available for fresh charge |
| High exhaust back-pressure | Residuals harder to expel |

---

## Throttle Body Size

For a given power target:
```
  A_throttle_min = P_target / (η_thermal × Q_fuel_stoich × ρ_air × v_mean_throat)
```

A rough rule of thumb: 1 mm of throttle diameter per ~10–15 kW of power.
A 44 mm throttle body can support approximately 80–100 kW naturally aspirated.

---

## Simulation Notes

For an intake system simulation you need:

- Throttle position (0–1) → manifold pressure (via isentropic throttle flow or
  simplified model)
- Manifold pressure → air mass entering cylinder per cycle (via ideal gas law and
  valve timing window)
- `ambient_pressure`, `ambient_temperature` — boundary conditions
- `throttle_diameter` — sets the maximum flow area
- Optionally: runner length → resonant RPM → ηv correction factor vs RPM
- The intake valve lift profile (see [05-valve-train.md](05-valve-train.md)) sets
  the effective flow area at each crank angle
- Cylinder filling mass ≈ P_manifold × Vd / (R_air × T_intake)
