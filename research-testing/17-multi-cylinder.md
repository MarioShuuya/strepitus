# Testing — Multi-Cylinder Engines

## What Is Tested

Multi-cylinder engine testing extends single-cylinder measurements to assess:
cylinder-to-cylinder balance (IMEP, lambda, timing), mechanical balance (primary and
secondary forces), NVH (noise, vibration, harshness), firing order effects, and
torsional crankshaft dynamics under combined cylinder loading.

---

## Cylinder-to-Cylinder Balance

### Per-Cylinder IMEP

```
  Instrument: Kistler 6125 pressure transducer in each cylinder (one per cylinder)
  Method: simultaneous acquisition — all cylinders referenced to the same crank angle
  DAQ: synchronised angle-domain sampling at 0.1° CA resolution

  Balanced engine criterion:
    COV_IMEP per cylinder: < 2%
    IMEP spread across cylinders: < 5% of mean IMEP

  Imbalance causes:
    Injector-to-injector flow variation (fuel delivery)
    Air distribution non-uniformity (intake manifold geometry)
    Compression ratio variation (machining tolerances, carbon deposits)
    VVT phasing deviation (individual cam phaser response)
```

### Per-Cylinder Lambda

```
  Wide-band sensors: one Bosch LSU 4.9 per cylinder exhaust port (or port-mounted)
  OR: a single fast-response lambda sensor with rapid multiplexing

  Alternative: NDIR/FID spectrometer sampling each cylinder sequentially
  → measure HC, CO, CO₂ per cylinder to derive cylinder-specific lambda

  Cylinder lambda spread: should be < 0.02 lambda for a well-calibrated engine
```

### Per-Cylinder Injection Timing / Quantity

```
  Injector current clamp (Pearson 101 or Tektronix TCP0030A) on each injector
  Measure:
    Injection duration [ms] — verify ECU commands matched
    Dead time variation — injectors have manufacturing tolerance ±0.05 ms
    Actual vs commanded pulse width

  Fuel flow per cylinder from:
    m_fuel_cyl = K_inj × PW_actual × √(P_fuel - P_manifold)
```

---

## Crankshaft Torsional Vibration

### Measurement

```
  Instrument: non-contact encoder (optical or magnetic) on crankshaft nose
  Resolution: 360–3600 pulses per revolution
  Software: Brüel & Kjær PULSE or National Instruments Order Analysis

  Output:
    Torsional vibration amplitude [°pk-pk or rad/s] vs engine order
    Campbell diagram: amplitude vs RPM vs engine order (colourmap)
```

### Resonance Identification

```
  Critical speeds: N_resonance = 60 × f_natural / engine_order

  Example (4-cylinder, 4-stroke, main excitation at 2nd engine order):
    If torsional resonance at 120 Hz, resonance at 2nd order → N = 60 × 120 / 2 = 3600 RPM

  Acceptance criterion:
    Amplitude < 0.5°pk-pk at all operating speeds
    No resonance in idle–redline range with amplitude > 1°pk-pk
```

---

## NVH — Vibration Measurement

### Engine Block Vibration

```
  Instrument: accelerometers (PCB 352C68, ICP)
  Mounting: on engine block, cylinder head, and mounts
  Axes: tri-axial (X, Y, Z) at each location
  Bandwidth: 1–10,000 Hz
  Sampling: 50 kHz (to capture up to 20 kHz structural modes)

  Analysis:
    Overall vibration level: a_rms [m/s²] or [g_rms]
    Order analysis: vibration amplitude at each engine order (0.5×, 1×, 2×, 4×, ...)
    Waterfall plot: amplitude vs frequency vs RPM
```

### Primary and Secondary Balance

```
  Free forces from a multi-cylinder engine:
    F_primary = Σ m_recip × r × ω² × cos(θ_i)    [at 1× engine order]
    F_secondary = Σ m_recip × r × ω² × (r/l) × cos(2θ_i)    [at 2× engine order]
    M_primary = Σ m_recip × r × ω² × cos(θ_i) × z_i    [rocking couple]

  Measurement: tri-axial accelerometers on rigid engine mounts + load cells
  Compare measured forces to analytical predictions from known firing order and geometry
```

### Balance Shaft Effectiveness

```
  Test: run with and without balance shaft(s) engaged
  Measure reduction in 2nd order vibration
  Target: 2nd order force < 10% of unbalanced value after balance shaft cancellation
```

---

## Acoustic Testing (Combustion Noise)

### In-Cylinder Pressure → Structure-Borne Noise

```
  Method: rapid combustion pressure rise (dP/dθ) drives block ringing
  Instrument: simultaneously measure in-cylinder pressure + accelerometer on block

  Combustion noise indicator:
    NI = 20 × log₁₀(dP/dθ_max / dP/dθ_ref)    [dB]

  Diesel knock limit: NI < 6 dB above reference (typically 1 MPa/ms)
  Gasoline knock: rapid last-cycle pressure oscillation > 0.5 bar pk-pk at > 5 kHz
```

### Sound Pressure Level (SPL) in Semi-Anechoic Chamber

```
  Instrument: free-field microphones (B&K Type 4191) at 1 m from engine surfaces
  Standard: ISO 3744 (sound power), SAE J1074 (engine radiated noise)
  Analysis:
    SPL [dB(A)] at each microphone position
    Sound power level L_W from multi-microphone integration
    Order spectrum: identify dominant noise sources at each engine order
```

---

## Firing Order Verification

### Timing Light Verification

```
  Method: timing light with advance pickup on each ignition coil primary
  Verify firing sequence matches expected order (e.g. 1-3-4-2 for I4)
  Measure: crank angle at which each cylinder fires relative to TDC marker

  Acceptance: each cylinder fires within ±1° of expected crank angle
```

### Combustion Event Timing from Pressure

```
  From multi-cylinder in-cylinder pressure:
    CA10, CA50, CA90 per cylinder per cycle
    Verify CA50 spacing matches expected firing interval
    For I4 (4-stroke): each cylinder should fire 180° apart
```

---

## Intake Manifold Distribution

### Flow Distribution Test (Cold, Non-Fired)

```
  Method: seal exhaust ports, apply measured vacuum to intake plenum
  Instrument: LFE (laminar flow element) or pitot tube array at each intake port
  Measure: flow rate to each cylinder at equal vacuum

  Acceptance: flow spread < 3% across all cylinders
  Correction: manifold geometry changes (runner length, plenum volume)
```

---

## Key Accuracy Summary

| Measurement | Instrument | Typical uncertainty |
|---|---|---|
| Per-cylinder IMEP | Kistler 6125 + angle DAQ | ±0.5% IMEP |
| Per-cylinder lambda | Bosch LSU 4.9 per port | ±0.01 lambda |
| Torsional vibration amplitude | Optical encoder + order analysis | ±0.05°pk-pk |
| Block vibration level | PCB 352C68 accelerometer | ±3% (g_rms) |
| Combustion noise NI | In-cylinder P + accelerometer | ±0.5 dB |
| Sound power level | Multi-microphone + ISO 3744 | ±1.5 dB |
| Firing order timing | Timing light / CA50 from pressure | ±1° CA |
| Intake flow distribution | LFE at ports | ±2% |
