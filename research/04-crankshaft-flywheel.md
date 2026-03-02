# Crankshaft and Flywheel

## What They Are

The **crankshaft** is the rotating backbone of the engine. It converts the
reciprocating (back-and-forth) motion of the pistons into continuous rotational
motion via the connecting rods. Each cylinder contributes torque pulses, and
the crankshaft sums them.

The **flywheel** is a heavy disc bolted to the rear of the crankshaft. Its job
is to store rotational kinetic energy during the power stroke and release it
through the three non-productive strokes, smoothing the output torque.

---

## Crankshaft Anatomy

```mermaid
graph LR
  FRONT["Front nose: pulley, accessory drive, VVT phaser"] --> MJ1["Main Journal 1"]
  MJ1 --> THROW1["Crank Throw 1: crankpin + counterweights"]
  THROW1 --> MJ2["Main Journal 2"]
  MJ2 --> THROW2["Crank Throw 2"]
  THROW2 --> MJ3["Main Journal 3 etc"]
  MJ3 --> REAR["Rear flange: flywheel mount"]
```

| Part | Function |
|---|---|
| Main journals | Rotate in main bearings in the engine block |
| Crankpins (rod journals) | Big end of con rod rotates on this |
| Crank throws | Offset between main journal axis and crankpin axis — generates the stroke |
| Counterweights | Offset mass opposite the throws — reduce main bearing loads |
| Front nose | Drives timing belt/chain, accessories |
| Rear flange | Mounts flywheel or flex plate |

---

## Key Parameters

| Parameter | Symbol | Typical value | Unit |
|---|---|---|---|
| Crank throw radius | r = S/2 | 30–50 mm | m |
| Stroke | S = 2r | 60–100 mm | m |
| Main journal diameter | — | 45–65 mm | mm |
| Crankpin diameter | — | 40–55 mm | mm |
| Crankshaft + flywheel inertia | J | 0.05–0.5 kg·m² | kg·m² |

---

## Kinematics

The crankshaft is defined by the crank throw r and rotates at angular velocity ω.
The crankpin traces a circle of radius r about the main bearing axis. This circular
motion, transmitted through the con rod, becomes the sinusoidal piston motion.

### Rotational Dynamics (Newton's 2nd Law for Rotation)

The crankshaft is modelled as a rotating inertia with net torque applied:

```
  J × dω/dt = τ_net

  τ_net = τ_combustion(θ) - τ_friction - τ_inertia_recip - τ_load

  dθ/dt = ω
```

This pair of ODEs is the core of the engine simulation. Integrating them forward
in time (with small crank angle steps) gives ω(t) and θ(t).

### Torque from Combustion
```
  τ_combustion = F_piston × r × sin(θ + β) / cos(β)

  where β = arcsin(λ sinθ),  λ = r/L
```

### Reciprocating Inertia Reaction Torque
The reciprocating masses accelerate and decelerate, which creates a reaction torque
on the crankshaft. For a single cylinder:
```
  τ_inertia = m_recip × a(θ) × r × sin(θ + β) / cos(β)

  a(θ) = ω² × r × (cosθ + λ cos2θ)
```

This is internally balanced within the crank slider — F_gas and F_inertia both flow
through the same rod, so only the net force goes to the crankpin.

---

## Counterweights

Counterweights are added opposite to each crankpin throw to reduce the centrifugal
force that would otherwise load the main bearings. They balance the **rotating mass**
(crankpin + con rod big end fraction). They cannot balance the reciprocating mass —
that requires multi-cylinder geometry or separate balance shafts.

### Perfect Balance of Rotating Parts
```
  m_counterweight × r_cw = m_rotating × r_crankpin

  m_rotating ≈ m_crankpin_mass + (2/3) × m_con_rod
```

---

## Flywheel

The flywheel stores kinetic energy, smoothing the torque fluctuation between cylinders.

### Rotational Kinetic Energy
```
  E_k = (1/2) × J × ω²    [J]
```

### Coefficient of Fluctuation of Speed
```
  δ = (ω_max - ω_min) / ω_mean

  Lower J → higher δ (rougher idle)
  Higher J → lower δ (smoother but slower response)
```

For a single-cylinder 4-stroke engine at idle, δ can be very high (0.1–0.2) because
there is only one power stroke per 720°. Multi-cylinder engines need much less flywheel
for the same smoothness because power strokes are more frequent and overlap.

### Flywheel Sizing Rule of Thumb
```
  J_required ≈ τ_peak × Δθ / (δ × ω²)

  where Δθ = angular extent of the power stroke impulse
```

### Dual Mass Flywheel (DMF)
Modern cars use a dual mass flywheel: two flywheel masses connected by arc springs.
The springs act as a torsional vibration absorber, filtering combustion impulses from
the transmission. This allows smaller, lighter flywheels while still isolating gear rattle.

---

## Torsional Dynamics

The crankshaft is not perfectly rigid — it twists under load. Each throw-to-throw
section is a torsional spring:

```
  K_torsion = G × J_polar / L_section    [N·m/rad]

  G = shear modulus (steel ≈ 80 GPa)
  J_polar = polar moment of area of the journal cross-section
```

Torque pulses from each cylinder excite torsional resonances. The **natural frequency**
of torsional vibration is:
```
  f_n = (1/2π) × √(K / J_effective)    [Hz]
```

If this resonance falls within the operating RPM range, the crankshaft can experience
large oscillating stresses — potentially fatigue failure. The **torsional vibration
damper** (harmonic balancer) on the front nose is a rubber-coupled inertia ring that
absorbs this energy.

---

## Multi-Cylinder Crank Geometry

In a multi-cylinder engine, the crankpins are arranged at angular offsets to:
1. Space the firing events evenly (smooth torque)
2. Balance primary and secondary forces
3. Minimise bending moments in the crankshaft

| Config | Firing interval | Crank throws |
|---|---|---|
| I4 (4-stroke) | 180° | 0°, 180°, 540°, 360° (1-3-4-2) |
| I6 (4-stroke) | 120° | 0°, 120°, 240°, 360°, 480°, 600° |
| V8 cross-plane | 90° | 0°, 90°, 270°, 180°, 630°, 540°, 450°, 360° |
| V8 flat-plane | 90° | 0°, 180°, 90°, 270° (×2 banks) |

The **flat-plane V8** (used in Ferrari, Ford GT, some BMW M) has a simpler crankshaft
but worse primary balance — it requires balance shafts or is accepted as a trade-off
for higher revving.

---

## Simulation Notes

For a crankshaft/flywheel simulation you need:

- `crankshaft_inertia` J — the dominant parameter for RPM dynamics
- Torque balance equation: J × dω/dt = τ_net
- Integration method: Euler or RK4 over small crank angle steps
- `stroke` → r = S/2 — used in torque calculation
- For multi-cylinder: sum torques from all cylinders at their respective crank offsets
- RPM = ω × 60 / (2π)

The inertia J is the sum of: crankshaft body, flywheel, harmonic balancer, and
the rotating fraction of each con rod (≈ 2/3 × m_con_rod × r²).
