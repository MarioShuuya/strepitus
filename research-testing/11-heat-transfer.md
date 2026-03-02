# Testing — Heat Transfer

## What Is Tested

Heat transfer testing measures how much energy leaves the cylinder through the walls,
and what temperatures the combustion chamber components reach at steady state. This
data calibrates the wall heat loss model — a critical factor for predicting IMEP
and combustion efficiency correctly.

---

## Heat Flux Measurement

### Thin-Film Heat Flux Sensors

Installed flush with the combustion chamber surface (head, piston crown, or liner).
A thin thermoelectric element measures the temperature gradient across a known
thermal resistance layer:

```
  q̇ = k × ΔT / δ    [W/m²]

  k = sensor thermal conductivity
  δ = sensor thickness (~10–50 µm)
  ΔT = temperature difference across sensor
```

**Equipment:** Vatell HFM-7 (rise time < 3 µs, range ±1 MW/m²), Medtherm sensors,
ROPER thin-film sensors.

**Peak heat flux values:**
```
  At TDC during combustion: 1–5 MW/m² (brief spike)
  Cycle-averaged: 0.1–0.5 MW/m²
  At BDC during intake: 0.01–0.05 MW/m²
```

### Miniature Thermocouple

Faster response than embedded thermocouples, but still limited (~100 Hz vs cycle
frequency of 50–150 Hz at typical operating conditions). Used for cycle-averaged
wall temperature rather than cycle-resolved heat flux.

---

## Coolant Heat Rejection Measurement

The total heat rejected to the coolant is measured calorimetrically:

```
  Q̇_coolant = ṁ_coolant × Cp_coolant × ΔT_coolant

  ṁ_coolant: measured with a flow meter (Coriolis or paddlewheel)
  ΔT_coolant: measured with matched PT100 sensors at inlet and outlet
  Cp_coolant: known from mixture ratio (water-glycol at known concentration)
```

**Accuracy:**
- Flow rate: ±1%
- Temperature difference: ±0.2°C
- Total heat rejection: ±2–3%

Combined with fuel energy input (from fuel flow × LHV), this gives the heat
balance and verifies the simulation's energy closure.

---

## Engine Heat Balance

A complete heat balance at each operating point:

```
  Q̇_fuel = P_brake + Q̇_coolant + Q̇_exhaust + Q̇_radiation + Q̇_oil

  Q̇_fuel = ṁ_fuel × LHV    [W]
  P_brake: from dyno [W]
  Q̇_coolant: calorimetric [W]
  Q̇_exhaust: ṁ_exhaust × Cp_exhaust × (T_exhaust - T_ambient) [W]
  Q̇_radiation: estimated ~2–5% of fuel energy (not directly measured)
  Q̇_oil: optional, oil cooler calorimetry [W]
```

Closure check: sum should equal Q̇_fuel within ±2–3%.

---

## Wall Temperature Measurement

### Embedded Thermocouples

K-type or J-type thermocouples embedded at various depths in the cylinder liner,
cylinder head, piston crown (via telemetry):

```
  Typical measurement locations:
  - Cylinder liner: 1 mm and 5 mm from bore surface, at multiple heights
  - Cylinder head: between intake and exhaust valves (hottest point)
  - Piston crown: via telemetry (see [02-piston-assembly.md](02-piston-assembly.md))
  - Coolant outlet: bulk coolant temperature
```

**Accuracy:** ±2–3°C at steady state.

### Infrared Thermography

Infrared camera imaging of the disassembled engine (immediately after shutdown):

```
  Camera: FLIR T1020, Optris PI 640
  Emissivity calibration required (aluminium: ε ≈ 0.2, cast iron: ε ≈ 0.8)
  Resolution: 0.1°C at room temperature
```

Useful for mapping temperature distributions across surfaces (hot spots, uneven cooling).

---

## Woschni Constant Calibration

The key outcome of heat transfer testing is calibration of the Woschni correlation's
empirical constant C₁ for the specific engine:

```
  Procedure:
  1. Measure heat rejection Q̇_coolant at several operating points
  2. From combustion analysis: calculate heat release dQ_comb/dθ
  3. Energy balance: Q̇_wall_model = Q̇_fuel - P_indicated - Q̇_exhaust
  4. Adjust C₁ in Woschni until simulated Q̇_wall matches measured Q̇_coolant + radiation

  Typical calibrated C₁:
    Stock: C₁ ≈ 3.26 (Woschni 1967 original)
    Modern engines (lower C₁ = less heat loss): C₁ ≈ 2.5–3.5
```

---

## Key Accuracy Summary

| Measurement | Instrument | Typical uncertainty |
|---|---|---|
| Peak heat flux | Thin-film sensor | ±5–10% |
| Cycle-average heat flux | Thin-film sensor | ±3–5% |
| Coolant heat rejection | Calorimetric | ±2–3% |
| Wall temperature | Embedded thermocouple | ±2–3°C |
| Heat balance closure | All above combined | ±3–5% |
