# Testing — Intake System

## What Is Tested

Intake system testing measures: manifold pressure, intake air temperature, mass airflow,
volumetric efficiency vs RPM, and throttle flow characteristics. These directly set
the cylinder filling and therefore the torque output.

---

## Manifold Absolute Pressure (MAP)

A piezoresistive pressure transducer in the intake manifold plenum:

```
  Instrument: Honeywell MLH series, Kistler 4045, NovaSensor P series
  Range: 0–200 kPa absolute
  Accuracy: ±0.1% FS = ±0.2 kPa
  Response time: < 1 ms (adequate for manifold filling dynamics at most RPMs)
```

MAP is sampled both time-based (for steady-state map generation) and angle-based
(for transient/cycle-resolved analysis). At high RPM, significant pressure pulsations
are visible in MAP — these are the intake pressure waves from valve opening events.

---

## Mass Airflow (MAF)

Two primary methods:

### Hot-Film MAF Sensor

A heated sensing element is cooled by the airflow. The power required to maintain
constant temperature is proportional to mass flow rate.

```
  Instrument: Sensirion SFM3300, Bosch HFM-7, Delphi mass airflow sensor
  Range: 0–600 kg/h (for large engines)
  Accuracy: ±1.5% of reading, ±0.5% FS
  Response time: 5–15 ms
```

### Laminar Flow Element (LFE)

A bundle of precision capillary tubes creates laminar flow. The pressure drop
across the element is exactly proportional to volumetric flow rate (Hagen-Poiseuille):

```
  Q = ΔP × π × r⁴ / (8 × η × L)    [m³/s per tube]

  ṁ = Q × ρ_air
```

**Accuracy:** ±0.5–1% of reading. The gold standard for steady-state calibration,
but slow response (not suitable for transient measurements).

---

## Volumetric Efficiency Measurement

Volumetric efficiency ηv is derived from measured airflow and engine geometry:

```
  ηv = (ṁ_air × 2) / (ρ_ambient × Vd × RPM/60)

  The factor 2 is because there is one intake event per 2 revolutions (4-stroke)

  Or per cylinder:
  ηv = (ṁ_air_per_cylinder) / (ρ_ambient × Vd_single × firing_frequency)
```

**ηv is measured on the engine dyno** across the full RPM range at WOT. The resulting
ηv(RPM) curve reveals the intake resonance peak and provides the calibration target
for the gas exchange model.

Typical measurement: every 250–500 RPM from idle to redline, steady-state at each point.

---

## Throttle Flow Characterisation

The throttle body is characterised on a flow bench before installation:

```
  Test: fix throttle angle → measure ΔP and ṁ → compute Cd and A_eff
  Repeat for throttle angles from 5° to 90° in 5° increments
  Temperature: 20°C ± 1°C

  Result: table of A_eff(α) or Cd(α), or equivalent discharge area
```

**Effective area:**
```
  A_eff(α) = ṁ / (P_upstream × √(2/(R×T_upstream)) × f(P_ratio))

  where f(P_ratio) is the isentropic flow function
```

This Cd(α) or A_eff(α) table is the calibration input for the throttle flow model.

---

## Intake Air Temperature (IAT)

```
  Instrument: NTC thermistor or PT100 RTD
  Location: in the inlet stream, upstream of throttle body
  Accuracy: ±0.5°C
  Response: ~5–30 s (thermal mass of sensor body)
```

IAT affects air density and therefore fill mass. A 10°C change in IAT causes ~3% change
in air density and roughly proportional change in power.

---

## Pressure Wave Measurement

To capture the intake pressure wave dynamics (for 1D model calibration):

```
  Fast-response pressure transducers mounted at multiple points in the intake:
    - Plenum: manifold average pressure
    - Runner entry: wave arriving from throttle
    - Runner exit (near valve): wave arriving at valve
  Sampling: angle-triggered at 0.1° resolution
```

The measured pressure at the runner exit allows direct calibration of the 1D pipe
model — by matching the simulated wave timing and amplitude to the measured data.

---

## Key Accuracy Summary

| Measurement | Instrument | Typical uncertainty |
|---|---|---|
| Manifold pressure MAP | Piezoresistive transducer | ±0.2 kPa |
| Mass airflow (steady) | LFE | ±0.5% |
| Mass airflow (transient) | Hot-film MAF | ±2% |
| Volumetric efficiency ηv | Derived from MAF + RPM | ±1–2% |
| Intake air temperature | PT100 | ±0.5°C |
| Throttle effective area | Flow bench | ±1% |
