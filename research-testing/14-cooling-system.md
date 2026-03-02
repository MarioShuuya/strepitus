# Testing — Cooling System

## What Is Tested

Cooling system testing verifies heat rejection capacity, coolant flow rates, component
temperatures, and thermostat operation. It ensures the engine operates within temperature
limits across all conditions. This data establishes the thermal boundary conditions
for the simulation.

---

## Coolant Temperature Measurement

```
  Instrument: PT100 RTD (four-wire connection for highest accuracy)
  Locations:
    - Thermostat inlet (engine outlet temperature, controlled target)
    - Thermostat outlet (after radiator, what the engine receives)
    - Cylinder head coolant jacket (internal, via port)
    - Cylinder block jacket (multiple points)
  Range: -40°C to +150°C
  Accuracy: ±0.1°C (PT100 with calibrated DAQ), ±0.5°C (NTC thermistor)
```

### Temperature Distribution

During steady-state operation, measuring at multiple locations reveals:

```
  ΔT across engine = T_engine_outlet - T_engine_inlet

  Typical at full load: ΔT = 5–15°C
  Very high load: ΔT up to 25°C

  High ΔT indicates: inadequate coolant flow, restricted passages, too-small
  water pump, or insufficient radiator capacity
```

---

## Coolant Flow Rate Measurement

```
  Instrument: clamp-on ultrasonic flow meter (non-invasive, no pressure drop)
  Examples: Endress+Hauser Prosonic Flow, Bürkert FLOWave
  Location: main coolant hose between engine and radiator
  Range: 20–200 L/min (typical engine range)
  Accuracy: ±1–2%

  Typical coolant flow:
  Idle: 20–40 L/min
  WOT (high RPM): 80–200 L/min
```

---

## Heat Rejection Rate Measurement

From coolant flow and temperature difference:

```
  Q̇_coolant = ṁ_coolant × Cp_coolant × ΔT

  ṁ_coolant = Q_flow × ρ_coolant    [kg/s]
  Cp_coolant = 3400 J/(kg·K) for 50/50 water-glycol
  ΔT = T_outlet - T_inlet

  Accuracy of Q̇_coolant: ±3–5%
```

Example: At 80 kW brake power for a gasoline engine (~33% efficiency):

```
  Q̇_fuel = 80 / 0.33 ≈ 242 kW
  Q̇_exhaust ≈ 0.35 × 242 ≈ 85 kW
  Q̇_coolant ≈ 0.30 × 242 ≈ 73 kW
  → Expected Q̇_coolant ≈ 70–80 kW at full load
```

---

## Thermostat Testing

### Flow vs Temperature Curve

The thermostat is removed and tested on a bench in a water bath at controlled temperature:

```
  Test: increase water temperature from 60°C to 105°C in 1°C steps
  Measure: bypass flow valve lift vs temperature
  Output: opening temperature, full-open temperature, full-open lift

  Standard thermostat: opens at 80–92°C, full open by 100°C
  Fully open lift: ~6–12 mm (varies by design)
```

A failed thermostat (stuck open at 60°C) keeps the engine cold:
- Excessive fuel consumption (BSFC increases ~10% below optimal temperature)
- Higher HC emissions
- Oil never reaches full operating viscosity

---

## Cylinder Head Temperature (Internal)

Thermocouples embedded directly into the cylinder head casting between the exhaust
valve seats and near the spark plug:

```
  Location: between exhaust valve pocket and coolant jacket
  Typical steady-state temperature: 150–250°C (depends on load and cooling)
  Alarm threshold: > 300°C (head distortion, gasket failure risk)
  Accuracy: ±3°C

  Response to load change: 30–120 seconds (thermal mass of head)
```

---

## Cooling System Pressure Test

The coolant system is pressurised to the cap opening pressure (typically 0.9–1.5 bar
gauge) and left for 15 minutes:

```
  Pass: no pressure drop observed (system is leak-free)
  Fail: pressure drops → find leak source with UV dye or pressure-decay analysis

  Equipment: cooling system pressure tester (Laser Tools, Sealey)
```

Also used to check that the system can hold pressure during hot operation
(prevents boiling in hot spots near exhaust ports).

---

## Radiator Performance Test

Radiator heat rejection capacity is measured on an air-flow wind tunnel:

```
  Q̇_radiator = ṁ_coolant × Cp × (T_in - T_out)

  Tested at: various coolant flow rates × various air velocities
  Output: effectiveness ε = Q̇_actual / Q̇_max

  Q̇_max = C_min × (T_coolant_in - T_air_in)

  Typical radiator effectiveness: ε ≈ 0.7–0.85
```

---

## Key Accuracy Summary

| Measurement | Instrument | Typical uncertainty |
|---|---|---|
| Coolant temperature | PT100 | ±0.1–0.5°C |
| Coolant flow rate | Ultrasonic clamp-on | ±1–2% |
| Heat rejection rate | Calculated from above | ±3–5% |
| Cylinder head temperature | Embedded thermocouple | ±3°C |
| Thermostat opening temperature | Bench test | ±1°C |
| Radiator effectiveness | Wind tunnel | ±3–5% |
