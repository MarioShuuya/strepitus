# Testing — Lubrication System

## What Is Tested

Lubrication testing covers: oil pressure, oil temperature, bearing clearance verification,
oil viscosity, oil consumption, and oil quality/contamination. These measurements ensure
the lubrication model is realistic and that bearing friction predictions are calibrated.

---

## Oil Pressure Measurement

```
  Instrument: piezoresistive pressure transducer (Kistler 4045 or equivalent)
  Location: main oil gallery (typically at the oil filter outlet)
  Range: 0–10 bar
  Accuracy: ±0.1% FS = ±0.01 bar

  Typical values:
  Idle (750 RPM): 1.0–2.0 bar
  Cruise (3000 RPM): 2.5–5.0 bar
  WOT (6000 RPM): 3.5–7.0 bar (often at relief valve limit)
  Oil warning threshold: < 0.5 bar
```

Oil pressure is monitored continuously during all engine tests. A sudden drop indicates:
- Low oil level (air ingestion at pickup)
- Relief valve stuck open
- Bearing failure (excessive clearance)
- Oil pump failure

---

## Oil Temperature Measurement

```
  Instrument: K-type thermocouple or PT100 RTD
  Locations: oil sump, oil gallery (after filter), oil cooler inlet/outlet
  Accuracy: ±2°C
  Response: 5–30 s (bulk oil thermal mass)

  Steady-state targets:
  Sump: 90–110°C
  Gallery: 80–100°C
  Max allowed: 130–150°C (oil degradation accelerates above 120°C)
```

---

## Oil Viscosity Measurement

Viscosity is measured in the laboratory on a small oil sample:

### Kinematic Viscosity (Ubbelohde Viscometer)

```
  Method: measure time for oil to flow through a calibrated capillary under gravity
  Units: cSt = mm²/s
  Accuracy: ±0.5%

  Tested at 40°C and 100°C (standard SAE measurement temperatures)
  Viscosity index calculated from the two measurements:
  VI = (L - U)/(L - H) × 100    (ASTM D2270 formula)
```

### Dynamic Viscosity (Brookfield Rotational Viscometer)

```
  Method: measure torque on a rotating spindle in the oil
  Units: mPa·s = cP
  Accuracy: ±1–2%
  Useful for cold viscosity measurements (important for cold-start friction)
```

### High-Shear Viscosity (HTHS)

```
  HTHS = viscosity at 150°C and 10⁶ s⁻¹ shear rate (in engine bearing conditions)
  Measured with: Ravenfield viscometer, CCS (cold cranking simulator)
  Significance: directly predicts bearing film thickness in the hot engine
  Modern low-friction oils: HTHS > 2.9 mPa·s (API SN PLUS requirement)
```

---

## Bearing Clearance Measurement

Bearing oil clearance must be measured to validate the hydrodynamic bearing model.

### Methods

| Method | Accuracy | Notes |
|---|---|---|
| Plastigage | ±10 µm | Quick, works with assembled engine |
| Bore gauge + micrometer | ±1 µm | Most accurate, requires disassembly |
| CMM | ±0.5 µm | Highest accuracy, measures roundness too |

Typical clearances:

| Bearing | Target clearance |
|---|---|
| Main bearing (crankshaft) | 0.025–0.065 mm |
| Rod bearing (big end) | 0.025–0.060 mm |
| Cam bearing | 0.020–0.060 mm |

---

## Oil Consumption Measurement

Oil consumption is measured by the weight method:

```
  Weigh the engine oil before and after a defined test cycle (e.g. 10 hours at full load)
  Correct for any oil added or removed

  m_consumed = m_before - m_after    [g]
  Oil consumption rate = m_consumed / W_distance or W_time    [g/km or g/h]

  Acceptable: < 0.3 L/1000 km (typical production spec)
  Racing engines: > 1 L/1000 km (wider ring gap, higher blowby)
```

High oil consumption causes:
- Blue smoke (HC + oil droplets in exhaust)
- Catalyst poisoning (phosphorus from oil additives)
- Increased HC and PM emissions

---

## Oil Quality and Degradation Testing

Oil samples taken at regular intervals are sent to a lab for:

- **Viscosity** (kinematic at 100°C): compare to fresh oil spec
- **Total Base Number (TBN)**: alkalinity depletes as acid byproducts accumulate
- **Spectrometric analysis**: metal particles indicate component wear
  (Fe = ring/bore/crank, Al = piston, Cu = bushings, Si = dirt ingestion)
- **Water/glycol content**: contamination from coolant (head gasket issue)
- **Fuel dilution**: excessive short trips → fuel doesn't evaporate → dilutes oil

---

## Key Accuracy Summary

| Measurement | Instrument | Typical uncertainty |
|---|---|---|
| Oil pressure | Piezoresistive transducer | ±0.01 bar |
| Oil temperature | K-type thermocouple | ±2°C |
| Kinematic viscosity | Ubbelohde | ±0.5% |
| HTHS viscosity | Ravenfield | ±2% |
| Bearing oil clearance | Bore gauge + mic | ±1 µm |
| Oil consumption | Weight method (10 h) | ±5 g |
