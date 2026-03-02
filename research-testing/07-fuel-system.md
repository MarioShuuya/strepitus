# Testing — Fuel System

## What Is Tested

Fuel system testing covers: injector flow characterisation, AFR measurement (lambda),
fuel mass flow rate, and fuel properties. Accurate AFR measurement is the foundation
of combustion quality and emissions calibration.

---

## Fuel Mass Flow Measurement

### Coriolis Mass Flow Meter (Most Accurate)

Measures the Coriolis force imparted on vibrating tubes by the fuel flow:

```
  Instrument: Endress+Hauser Promass 83, Emerson Micro Motion
  Range: 0–100 kg/h (typical engine fuel range)
  Accuracy: ±0.1% of reading
  Output: kg/s or g/s, temperature-compensated
```

The gold standard for fuel economy and BSFC measurement. Essential for calibrating
the fuel model — every kg/h of error in fuel measurement causes a proportional
error in simulated BSFC.

### Gravimetric Method

Fuel is burned from a precision scale. Mass consumed over a timed interval:

```
  ṁ_fuel = Δm / Δt    [kg/s]
  Accuracy: ±0.2% with 60-second intervals
```

Simple and very accurate for steady-state. Not suitable for transient tests.

---

## Lambda (AFR) Measurement

### Wideband Lambda Sensor (UEGO)

A heated zirconia cell in the exhaust measures the oxygen partial pressure and
infers the mixture AFR. Used for steady-state and slow transient lambda measurement:

```
  Instruments: Bosch LSU 4.9 (most common), NTK L2H2
  Controller: ETAS LA4, Bosch MPS 4.2, NGK Powerdex AFX
  Range: λ = 0.65–∞ (λ > 1.8 approximate for rich limit)
  Accuracy: ±0.7% of λ reading in calibrated range, ±1–2% at extremes
  Response: T10–T90 ≈ 100–150 ms in exhaust stream
```

### FTIR Exhaust Gas Analysis (Most Complete)

Fourier Transform Infrared Spectroscopy analyses the exhaust composition for >30 species
simultaneously. From the concentration of CO₂, CO, O₂, HC, NOx, the exact lambda
can be calculated via the Brettschneider equation:

```
  λ = [CO₂ + CO/2 + O₂ + (HC/2)(3.5+1)] /
      [(CO₂ + CO) + (CO₂ + CO + O₂)/(CO₂ + CO + HC) × AFR_stoich/3.5]

  (Simplified — exact form varies by fuel composition)
```

**Equipment:** Horiba MEXA-7000 series, AVL FTIR analyser.
**Accuracy:** ±0.2% CO₂, ±10 ppm CO, ±1 ppm HC — overall lambda accuracy ±0.5%.

---

## Injector Characterisation

Individual injectors are characterised on an injector test bench before installation.
This ensures that the simulated fuel delivery matches the actual engine.

### Static Flow Rate

```
  Method: hold injector fully open, measure volumetric flow at rated pressure
  Typical: 150–600 cm³/min (PFI), higher for GDI
  Accuracy: ±0.5%
  Pressure: measured at rated conditions (e.g. 3 bar PFI, 200 bar GDI)
```

### Dynamic Characterisation

Pulse-width modulated at known frequency. Key curves:

- **Delivery vs pulse width:** linearity check. Non-linear at very short pulse widths
  (opening/closing transients dominate). Critical for idle quality.
- **Minimum pulse width:** below this, injector doesn't open reliably.
- **Injection delay:** time between ECU command and needle lifting (typically 0.5–2 ms).

```
  m_fuel = K_injector × (PW - PW_offset)    [linear region]
```

**Equipment:** Bosch EVRS injector test system, AVL injector characterisation bench.

---

## Fuel Properties Measurement

For simulation, the following fuel properties must be measured or referenced:

| Property | Measurement method | Accuracy |
|---|---|---|
| LHV (lower heating value) | Bomb calorimeter | ±0.1% |
| Density at 15°C | Digital density meter | ±0.1 kg/m³ |
| Stoichiometric AFR | FTIR or calculation from fuel analysis | ±0.2% |
| RON/MON | CFR engine test | ±0.5 octane |
| H/C/O atomic ratios | GC-MS fuel analysis | ±0.2% |

For simulation, using standard gasoline values (LHV = 44 MJ/kg, AFR_stoich = 14.7)
introduces < 2% error for typical pump gasoline. For E10–E85 blends, measured values
are essential.

---

## Fuel Injection Timing Measurement

Injection timing (when the injector fires relative to crank angle) is measured via:

```
  Method: magnetic pickup on injector solenoid current
  Output: current trace vs crank angle
  Start of injection (SOI): detected as current rise
  End of injection (EOI): detected as current fall

  Accuracy: ±0.5° crank (at 6000 RPM, 1° ≈ 28 µs)
```

---

## Key Accuracy Summary

| Measurement | Instrument | Typical uncertainty |
|---|---|---|
| Fuel mass flow (steady) | Coriolis meter | ±0.1% |
| Lambda (wideband) | Bosch LSU 4.9 + ETAS LA4 | ±0.7–1% |
| Lambda (FTIR derived) | Horiba MEXA-7000 | ±0.3–0.5% |
| Injector static flow | Bench test | ±0.5% |
| Fuel LHV | Bomb calorimeter | ±0.1% |
| Injection timing | Current probe + encoder | ±0.5° |
