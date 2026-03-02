# Testing — Ignition System

## What Is Tested

Ignition system testing covers: spark timing verification, knock detection and
characterisation, and ignition energy measurement. These measurements calibrate
the combustion initiation model.

---

## Spark Timing Measurement

### Current Probe Method

A current clamp on the spark plug wire or ignition coil primary captures the coil
discharge event. The current pulse corresponds to spark firing:

```
  Instrument: Tektronix A622 current probe (AC/DC, ±2 A, bandwidth 100 kHz)
  Signal: current vs time, combined with crank encoder
  Accuracy: ±0.5° (at 6000 RPM, 1° ≈ 28 µs)
```

This directly confirms the ECU commanded timing matches the actual spark event.
Discrepancy > 1° should be investigated (ignition coil dwell, spark advance table errors).

### Ion Current Sensing

The spark plug gap is used as an ion sensor after the primary ignition event.
During combustion, the ionised gas in the chamber conducts a small current through
the gap when a bias voltage is applied:

```
  Ion current I(θ) peak ≈ at peak pressure
  Combustion duration: width of ion current signal
  Knock: high-frequency oscillation superimposed on ion current
```

**Advantage:** no additional transducer required, uses existing spark plug.
**Accuracy:** qualitative (timing), not directly quantitative for pressure.
**Equipment:** Cyl-Sense ion current measurement system.

---

## Knock Detection and Measurement

### Accelerometer (Production Method)

A piezoelectric accelerometer bolted to the engine block measures vibration.
Knock produces a characteristic frequency band (typically 6–20 kHz depending on bore
size):

```
  Knock frequency: f_knock ≈ 900 × v_sound / bore

  For bore = 86 mm: f_knock ≈ 900 × 340 / 0.086 ≈ 3.6 kHz (first mode)

  Instrument: Kistler 601A, Bosch 0 261 231 173
  Method: band-pass filter around knock frequency → rectify → compare to threshold
```

**Accuracy:** detects knock reliably at knock intensities > ~0.2 MPa peak pressure
oscillation. Cannot distinguish light knock from heavy knock quantitatively.

### Cylinder Pressure Analysis (Reference Method)

The most accurate knock measurement uses the in-cylinder pressure trace:

```
  Knock Intensity (KI) = peak-to-peak amplitude of the high-pass filtered P(θ)

  High-pass filter: > 3–5 kHz (removes the slow combustion pressure rise)
  KI threshold for "trace knock": ~0.3–0.5 bar peak-to-peak
  KI threshold for "heavy knock": > 5 bar peak-to-peak
```

Maximum Amplitude of Pressure Oscillation (MAPO):
```
  MAPO = max|P_filtered(θ)|    for θ in [θ_spark, θ_spark + 60°]
```

This is the research standard for knock quantification.

**Equipment:** Kistler cylinder pressure + charge amp + combustion analyser software
(AVL Indicom, ETAS IndiCom, Kristler KiBox).

---

## MBT Timing Determination

MBT (Minimum Advance for Best Torque) is found by sweeping spark advance at constant
speed and load on the dyno:

```
  1. Hold constant RPM (dyno speed control) and constant fuel flow
  2. Sweep spark advance from retarded (e.g. 10° BTDC) to advanced (e.g. 40° BTDC)
     in 2° increments
  3. Measure torque at each point (allow 10–30 seconds to stabilise)
  4. The advance giving maximum torque = MBT
```

**Knock-limited spark advance (KLSA):** If knock occurs before MBT is reached, the
advance where knock first appears is the KLSA. The engine is then run at KLSA,
not MBT.

Measured MBT data at each RPM × load point populates the base ignition map.

---

## Combustion Phasing Metrics

From combustion analysis (see [01-combustion-chamber.md](01-combustion-chamber.md)):

| Metric | Definition | Typical value at MBT |
|---|---|---|
| CA50 | Crank angle at 50% mass fraction burned | 6–12° ATDC |
| CA10 | Crank angle at 10% MFB | ~TDC to 5° ATDC |
| CA90 | Crank angle at 90% MFB | 20–30° ATDC |
| θ_Pmax | Crank angle at peak pressure | 12–18° ATDC |
| Burn duration | CA90 - CA10 | 15–30° |

These are the key reference values for Wiebe parameter calibration.

---

## Ignition Coil Energy Measurement

Spark energy affects cold-start, lean-mixture ignition, and EGR tolerance:

```
  E_spark = ∫ V_spark(t) × I_spark(t) dt    [mJ]

  Instrument: high-voltage differential probe (Tektronix P5200A) + current probe
  Typical spark energy: 30–100 mJ (primary discharge)
  Spark duration: 1–2 ms (conventional), up to 5 ms (multi-spark systems)
```

---

## Key Accuracy Summary

| Measurement | Instrument | Typical uncertainty |
|---|---|---|
| Spark timing | Current probe + encoder | ±0.5° |
| Knock intensity MAPO | Pressure transducer + HF filter | ±0.1 bar |
| MBT advance | Dyno torque sweep | ±0.5–1° |
| CA50 | Combustion analyser | ±0.5° |
| Burn duration (CA10–CA90) | Combustion analyser | ±1° |
| Spark energy | V×I integration | ±5% |
