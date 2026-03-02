# Testing — Exhaust System

## What Is Tested

Exhaust system testing covers: exhaust gas pressure and temperature, emissions
composition, blowdown timing and intensity, and exhaust noise. This data validates
the gas exchange model and provides inputs for the acoustic simulation.

---

## Exhaust Pressure Measurement

### Static Back-Pressure

Measured with a piezoresistive transducer in the exhaust manifold:

```
  Instrument: Kistler 4045, Honeywell MLH (absolute)
  Range: 0–3 bar absolute
  Accuracy: ±0.2 kPa
  Location: close to exhaust valve port (primary pipe)
```

Average back-pressure at WOT: typically 1.05–1.20 bar absolute (5–20 kPa above ambient).

### Dynamic Pressure Trace (Wave Measurement)

A fast-response piezoresistive transducer (< 1 ms response) captures the exhaust
pressure waves:

```
  Instrument: Kistler 4049A (response: 0.5 kHz natural frequency, adequate for
              wave frequencies up to ~200 Hz at normal RPMs)
  Sampling: angle-triggered at 0.1° for synchronisation with cylinder data
```

The measured exhaust pressure trace at the primary pipe exit reveals:
- Blowdown pulse timing and amplitude (at EVO)
- Reflected wave arrival timing (negative pressure scavenging pulse)
- Resonant frequencies of the exhaust runner system

This data is essential for calibrating the 1D exhaust gas dynamics model.

---

## Exhaust Gas Temperature (EGT)

```
  Instrument: K-type thermocouple (shielded, grounded junction) or NiCrSi thermocouple
  Location: 50–100 mm from exhaust valve exit (in primary pipe)
  Range: 0–1100°C
  Accuracy: ±5°C (steady state), ±15°C (transient — thermal mass of thermocouple)
  Response time: T63 ≈ 5–20 s for standard thermocouples

  Fast-response EGT: 0.076 mm wire diameter thermocouple: T63 < 50 ms
```

EGT is a key output for turbocharger protection and combustion diagnostics.

---

## Emissions Analysis

A complete exhaust emissions bench measures the major pollutant species. The measurement
location is typically after the catalyst (tailpipe) and before (pre-cat) for catalyst
efficiency testing.

### Five-Gas Analyser

| Species | Method | Typical accuracy |
|---|---|---|
| HC (total) | Flame Ionisation Detection (FID) | ±1 ppmC |
| CO | Non-Dispersive Infrared (NDIR) | ±0.01% vol |
| CO₂ | NDIR | ±0.1% vol |
| NOx | Chemiluminescence (CLD) | ±1 ppm |
| O₂ | Paramagnetic | ±0.01% vol |

**Equipment:** Horiba MEXA-7100, AVL FTIR, Sensors SEMTECH.

### Lambda from Exhaust Composition (Brettschneider Equation)

```
  λ = ([CO₂] + [CO]/2 + [O₂] + HC/(4×H_c/C_c) × (1 + H_c/C_c × 0.25)) /
      ([CO₂] + [CO] + HC/(H_c/C_c + 1)) × (AFR_stoich/3.5)

  (Simplified form — exact depends on fuel H/C/O ratios)
```

This gives lambda from exhaust gas composition, independent of AFR sensors.
Accuracy: ±0.5% of lambda value.

---

## Blowdown Characterisation

The blowdown event is characterised from the cylinder pressure trace at EVO:

```
  P_cylinder(EVO): read from combustion analyser at the crank angle where EVO occurs
  P_exhaust: read from exhaust pressure transducer at same moment

  Pressure ratio: r_blowdown = P_cylinder(EVO) / P_exhaust

  Typical: 3:1 to 8:1 (choked flow when r_blowdown > 1.89 for γ=1.35)
```

The blowdown energy can be estimated:
```
  E_blowdown = m_exhaust × Cp × T_exhaust × η_turb × (1 - (P_exhaust/P_cyl)^((γ-1)/γ))

  (Energy available to a turbine — turbocharged engines)
```

---

## Exhaust Acoustic Measurement

Exhaust noise is measured with a microphone at standardised distances (SAE J1492:
50 mm from exhaust outlet at 45°):

```
  Instrument: free-field condenser microphone (Brüel & Kjær 4189)
  Sampling: 50 kHz
  Analysis: FFT spectrum, octave band analysis, A-weighted SPL
  Standard: ISO 5130, ECE R51 (drive-by noise)
```

The frequency spectrum reveals the firing order harmonic series:
```
  f_fundamental = RPM × N_cylinders / (2 × 60)    [Hz]
  Harmonics at: f_fundamental, 2f, 3f, ...
```

---

## Key Accuracy Summary

| Measurement | Instrument | Typical uncertainty |
|---|---|---|
| Back-pressure (static) | Piezoresistive transducer | ±0.2 kPa |
| Dynamic exhaust pressure | Fast-response transducer | ±0.5 kPa |
| EGT (steady state) | K-type thermocouple | ±5°C |
| HC emissions | FID | ±1 ppmC |
| CO emissions | NDIR | ±0.01% vol |
| NOx emissions | CLD | ±1 ppm |
| Lambda from exhaust | Brettschneider | ±0.5% |
| Blowdown pressure ratio | Combustion analyser | ±2% |
