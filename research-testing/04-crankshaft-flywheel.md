# Testing — Crankshaft and Flywheel

## What Is Tested

Crankshaft testing covers: moment of inertia, torsional stiffness, torsional vibration
response, main bearing clearances, and flywheel mass properties. These parameters feed
directly into the rotational dynamics model.

---

## Moment of Inertia Measurement

The total rotational inertia J of the crankshaft + flywheel assembly is the dominant
parameter controlling RPM dynamics (how quickly the engine accelerates).

### Bifilar Suspension Method

The assembly is suspended from two parallel wires of equal length, forming a bifilar
pendulum. When twisted and released, it oscillates with a period:

```
  T = 2π × √(J / (m × g × d² / (2L)))

  where:
    m = total mass
    d = wire separation
    L = wire length
    T = oscillation period

  →  J = T² × m × g × d² / (8π²L)
```

**Accuracy:** ±1–3%. Main error: difficulty measuring exact wire positions and lengths.

### Torsional Oscillation on Test Bench

More accurate: mount the crankshaft with a known torsional spring (calibrated shaft)
and measure the torsional natural frequency:

```
  f_n = (1/2π) × √(k/J)

  →  J = k / (2π × f_n)²
```

**Accuracy:** ±0.5–1%.

### CAD-Based Calculation

For known geometry and material density: J from 3D model is very accurate (±0.5%
if density and geometry are well-known). Used in design phase.

---

## Torsional Vibration Measurement

Torsional vibration (TV) is the oscillating twist of the crankshaft during running.
Uncontrolled TV causes crankshaft fatigue failure.

### Measurement Method: Non-Contact Encoder

A ring gear (or dedicated toothed wheel) is mounted on the crankshaft. A proximity
sensor counts tooth pass times. Instantaneous angular velocity ω(t) varies as the
crank twists:

```
  ω_i = 2π / (N_teeth × Δt_i)

  where Δt_i = time between consecutive tooth passes
```

Torsional vibration amplitude = peak variation in ω(t) around mean ω.

**Equipment:** Dewetron DEWE-2600 with angular encoder module, or Kistler
angular rate sensor.
**Accuracy:** angular velocity variation ±0.01 rad/s, displacement ±0.01°.

### Order Analysis

Torsional vibration is analysed in the frequency domain as engine orders:

- Order 0.5: once per two revolutions (4-stroke fundamental)
- Order 1: once per revolution
- Order 2: twice per revolution (I4 secondary force)
- etc.

Critical orders that excite resonances must be confirmed by measurement.

---

## Main Bearing Clearance Measurement

The oil clearance between the crankshaft main journal and the bearing shell determines
the hydrodynamic film behaviour.

### Dial Gauge Method

With the crankshaft installed and main caps torqued, press the crank laterally and
measure displacement with a dial gauge. This gives the total radial clearance.
**Accuracy:** ±5 µm.

### Micrometer Method

Measure crankpin and bearing bore separately, compute difference:
```
  Oil clearance = Bearing bore ID - Journal OD
  Typical: 0.025–0.065 mm
```
**Accuracy:** ±1 µm with a calibrated micrometer set.

### Plastigage Method (Practical)

A strip of crushable plastic of known width is placed between journal and shell, then
cap is torqued and removed. The crushed width indicates oil clearance.
**Accuracy:** ±10 µm — adequate for confirmation but not for precise measurement.

---

## Flywheel Mass and Geometry

- **Mass:** precision balance, ±5 g
- **Outer diameter:** precision tape or CMM, ±0.1 mm
- **Radius of gyration:** computed from geometry (assuming uniform density disk)
  or measured on inertia test bench
- **Flywheel J contribution:** J_flywheel = m × r_gyr²

For a solid disk: r_gyr = r_outer / √2. For a ring flywheel: r_gyr ≈ r_outer (most
mass is at the outer radius — more effective for smoothing).

---

## Crankshaft Balance

After manufacture, the crankshaft is balanced on a dynamic balancing machine:

```mermaid
graph LR
  CRANK["Crankshaft mounted on balance machine"] --> SPIN["Spun at test speed 300-1000 RPM"]
  SPIN --> SENSORS["Force sensors at both main bearing supports measure imbalance"]
  SENSORS --> CORRECTION["Material removed by drilling at prescribed correction planes"]
  CORRECTION --> VERIFY["Re-spin to verify balance within tolerance"]
```

**Balance tolerance:** typically G6.3 grade (ISO 1940): residual imbalance
< 6.3 × m × ω mm/s in mm·g, where m is mass and ω is operating speed.

---

## Key Accuracy Summary

| Measurement | Method | Typical uncertainty |
|---|---|---|
| Moment of inertia J | Bifilar / oscillation | ±1–3% |
| Torsional vibration amplitude | Non-contact encoder | ±0.01° |
| Main bearing oil clearance | Micrometer method | ±1 µm |
| Flywheel mass | Balance | ±5 g |
| Balance residual | Balancing machine | ±0.1 g·mm |
