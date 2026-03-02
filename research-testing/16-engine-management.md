# Testing — Engine Management

## What Is Tested

Engine management testing validates ECU calibration maps, sensor accuracy, actuator
response, closed-loop control stability, and OBD-II diagnostic function. This is the
final integration layer that ties all individual component calibrations together.

---

## ECU Calibration Tools

### Industry-Standard Calibration Software

```
ETAS INCA (Integrated Calibration and Acquisition Systems):
  Protocol: ASAM XCP over CAN, USB, or Ethernet
  Function: read/write ECU calibration variables in real time
  Data: A2L (AUTOSAR) description file maps ECU RAM addresses to signal names
  Output: .mdf4 measurement files with all logged signals

ATI Vision (Applied Test & Integration):
  Common in US motorsport (NASCAR, IndyCar, IMSA)
  Protocol: proprietary or ASAM MCD

Pi System (Cosworth/Pi Research):
  Used in Formula motorsport
  Integrated with ECU logging at up to 1 MHz

MOTEC M1 Build:
  Package-based calibration for MoTeC ECUs
  Tuning tables editable live on track via PC link
```

### Calibration Parameters

Primary maps that require calibration:

```
  Fuel map: injector pulse width [ms] vs (RPM × load)
  Ignition map: spark advance [°BTDC] vs (RPM × load)
  VVT cam phasing map: cam advance [°] vs (RPM × load)
  Boost target map: boost pressure [bar] vs (RPM × load)
  Fuelling corrections: coolant temp, air temp, barometric compensation
  Idle speed control: target idle RPM, throttle/ISC duty cycle
  Knock retard map: ignition retard per knock event [°/count]
```

---

## Sensor Validation

### Crank Position Sensor (CKP)

```
  Instrument: oscilloscope (digital storage, 100 MHz bandwidth)
  Signal: 60-2 tooth wheel → variable reluctance or Hall effect output
  Test: capture waveform, confirm missing tooth at correct crank position
  Verify: tooth period monotonically decreases with rising RPM
  Accuracy: ±0.1° crank angle (Hall sensor), ±0.3° (VR sensor signal conditioning)
```

### Mass Air Flow (MAF) Sensor Calibration

```
  Reference: LFE laminar flow element (±0.2% accuracy)
  Method: compare MAF sensor voltage/frequency output to LFE reading
    over full flow range (idle to WOT)
  Output: correction table or polynomial fit
  Typical MAF uncertainty (factory): ±2–3%
  After calibration: ±1%
```

### Lambda Sensor Accuracy

```
  Instrument: Horiba MEXA-1600 or FTIR as reference (±0.002 lambda)
  Bosch LSU 4.9 wideband: ±0.008 lambda (1 sigma, after calibration)
  Test: step lambda from 0.8 to 1.2 via fuel trim, compare ECU vs FTIR
  Response time: τ₉₀ < 100 ms (sensor dead time + transport lag)
```

### Manifold Pressure (MAP) Sensor

```
  Reference: Druck DPI-610 pressure calibrator (±0.025% FS)
  Test: sweep manifold pressure from 0.3 bar (high vacuum, idle)
    to 3.0 bar (boost), compare MAP sensor vs reference
  Linearity: ±0.3% (typical MAP sensor)
  Temperature coefficient: ±0.02 kPa/°C (must correct for sensor body temp)
```

---

## Actuator Response Testing

### Throttle Body (Electronic)

```
  Test: step command from 0% to 100% pedal position
  Measure: actual throttle plate angle vs commanded angle
  Expected response time: < 200 ms (throttle by wire bandwidth ≈ 10 Hz)
  Instrument: LVDT or encoder on throttle plate shaft
```

### Fuel Injector Dead Time

```
  Method: measure minimum injection pulse width that produces measurable fuel flow
  Instrument: current clamp (Pearson 101) on injector drive wire + Coriolis fuel meter
  Dead time: typically 0.3–0.8 ms (battery voltage dependent)
  Calibration: inject dead time correction table vs battery voltage
```

### Ignition Coil Dwell

```
  Measure: dwell time required to build full coil current before spark
  Instrument: oscilloscope on primary coil drive signal
  Typical dwell: 2–4 ms (CDI coils), 3–8 ms (inductive coils)
  Test: verify spark energy is consistent at all RPM ranges
```

---

## Closed-Loop Control Validation

### Lambda Closed-Loop (Stoichiometric Control)

```
  Test: set long-fuel trim conditions (lean and rich bias), verify LTFT correction
  Acceptance criterion:
    LTFT < ±5% at all steady-state operating points
    Lambda deviation < ±0.01 from target at steady state

  Step response:
    Command lambda step from 0.95 to 1.05
    Measure settling time: should reach λ ± 0.005 within 5 seconds
```

### Boost Pressure Control (Wastegate PID)

```
  Test: step from cruise (1.0 bar) to WOT target (1.8 bar) at fixed RPM
  Measure:
    Rise time (10% to 90% of target): should match τ_spool ≈ 1–2 s
    Overshoot: < 0.1 bar (10% of target)
    Steady-state error: < 0.05 bar

  Instrument: Kistler 4045 boost transducer at 1 kHz
```

### Idle Speed Control

```
  Test: step from warm idle with AC load applied (compressor clutch engagement)
  Measure: RPM dip and recovery
  Acceptance criterion:
    RPM dip < 100 RPM below target
    Recovery within 3 seconds
  Load: ~50–100 Nm from AC compressor clutch engagement
```

---

## OBD-II Diagnostics Testing

### Diagnostic Trouble Code (DTC) Verification

```
  Method: EOBD-2 compliant scan tool (Bosch KTS, Snap-on Verus)
  Protocol: ISO 15765-4 (CAN), ISO 14230 (KWP2000), SAE J1850
  Test procedure: induce fault → verify DTC set correctly → clear DTC → verify cleared

  Examples:
    P0171 (System Too Lean Bank 1): LTFT > +25% for > 60 s
    P0300 (Random Misfire): IMEP variation > threshold in misfire detection window
    P0420 (Catalyst Efficiency Below Threshold): post-cat lambda oscillation amplitude
```

### Misfire Detection Calibration

```
  Method: segment-to-segment crankshaft speed variation analysis
  Signal: CKP tooth period irregularity per engine cycle
  Calibration: set misfire thresholds by inducing controlled misfires
    (disconnect injector coil one at a time, verify P030X DTCs set)
  Typical threshold: Δω > 3–8% of mean ω per segment
```

---

## ECU Data Logging (Measurement Data Files)

### MDF4 Format

```
  Standard: ASAM MDF 4.1 (Measurement Data Format)
  Contains: all logged signals with timestamp, unit, calibration
  Software: ETAS MDA, MATLAB Data Acquisition Toolbox, asammdf (Python, open-source)
  Typical log rate: critical signals at 100–1000 Hz, slow signals at 1–10 Hz
```

### Logged Quantities (Typical Full Dataset)

```
  Engine speed (RPM), load (mg/stroke or bar MAP)
  Lambda (pre-cat and post-cat)
  Injection pulse width, fuel trims (STFT, LTFT)
  Ignition advance (actual), knock count per cylinder
  VVT cam position (intake and exhaust)
  Boost pressure, wastegate duty cycle
  Coolant temperature, oil temperature, air temperature
  Battery voltage (affects injector dead time)
  Throttle position (pedal and plate)
```

---

## Key Accuracy Summary

| Measurement | Instrument | Typical uncertainty |
|---|---|---|
| Crank position | Hall effect CKP + DSO | ±0.1° CA |
| Mass air flow | LFE reference vs MAF | ±1% after calibration |
| Lambda (wideband) | Bosch LSU 4.9 vs FTIR | ±0.008 lambda |
| MAP sensor | Druck DPI-610 reference | ±0.3% |
| Ignition timing | Oscilloscope + timing light | ±0.5° CA |
| Boost control SS error | Kistler 4045 | < 0.05 bar |
| Fuel injection dead time | Current clamp + Coriolis | ±0.05 ms |
