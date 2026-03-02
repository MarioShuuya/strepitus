# Simulation — Valve Train

## What Is Simulated

The valve train simulation provides: valve lift at every crank angle, and the mass
flow rate through each valve (into and out of the cylinder). This is the gas exchange
model — it determines how well the cylinder is filled and scavenged.

---

## Valve Lift Profile Models

### 1. Sinusoidal Approximation

```
  L(θ) = L_max × sin(π × (θ - θ_open) / (θ_close - θ_open))
          for θ_open ≤ θ ≤ θ_close, else 0
```

Simple, smooth, physically reasonable. Captures the correct shape for simulation
purposes. Error vs real cam profile: ±5–15% on dL/dθ, ±10% on flow area at any
given angle.

**When to use:** parametric studies, unknown cam profile, early development.

### 2. Polynomial Profile (Bézier or Spline)

Using the measured Cd(L) and L(θ) data from the flow bench and CMM:
```
  L(θ) = interpolated from measured data table    [N points, N = measurement resolution]
```

Spline interpolation between measured points. This is what GT-Power uses when
measured cam data is provided.

**When to use:** when measured cam data is available. Accuracy: matches measurement
uncertainty (±0.05 mm lift, ±0.5° timing).

### 3. Direct Cam Follower Model

Computes valve lift directly from the cam lobe geometry and follower kinematics:
```
  L(α) = r_cam(α) - r_base_circle    (from CMM data)
  α = θ/2                             (cam at half crank speed)
```

Highest accuracy. Used in GT-Suite valve train module.

---

## Valve Flow Model — Isentropic Orifice

Mass flow through the valve is modelled as isentropic flow through a variable orifice:

### Flow Area

```
  A_valve(L) = Cd(L) × π × D_valve × L

  where:
    D_valve = valve head diameter
    L = current valve lift
    Cd(L) = discharge coefficient (from flow bench data or correlation)
```

If flow bench data is not available, a polynomial approximation for Cd(L):

```
  Cd(L) = C_ref × (1 - exp(-k × L/D_valve))

  Typical: C_ref ≈ 0.85, k ≈ 15–20
```

### Mass Flow Rate (Isentropic Compressible Flow)

Two flow regimes — subsonic (unchoked) and choked:

```
  Critical pressure ratio: Pr_crit = (2/(γ+1))^(γ/(γ-1)) ≈ 0.528 for γ=1.4

  If P_down/P_up > Pr_crit (subsonic):
    ṁ = Cd × A_valve × P_up / √(R × T_up) × √(γ) × (P_down/P_up)^(1/γ)
        × √(2γ/(γ-1) × [1 - (P_down/P_up)^((γ-1)/γ)])

  If P_down/P_up ≤ Pr_crit (choked, sonic at valve):
    ṁ = Cd × A_valve × P_up / √(T_up) × √(γ/R) × (2/(γ+1))^((γ+1)/(2(γ-1)))
```

This is the **Barré de Saint-Venant equation**, the standard for valve flow in 1D
engine codes (GT-Power, AVL BOOST, Ricardo WAVE all use this).

### Flow Direction

- During intake: P_manifold > P_cylinder (normally) → intake valve, flow into cylinder
- During exhaust: P_cylinder > P_exhaust → exhaust valve, flow out of cylinder
- Back-flow: possible near TDC during overlap — the same formula handles this
  by detecting when P_down > P_up (flow reversal)

---

## Gas Exchange Loop

The valve flows update the cylinder gas mass at each simulation step:

```
  During intake (intake valve open):
    dm_cylinder/dθ = ṁ_intake(θ) / ω    [kg per radian → kg per radian]

    T_in = T_manifold (incoming gas temperature)
    Enthalpy in: h_in = Cp × T_in × dm

  During exhaust (exhaust valve open):
    dm_cylinder/dθ = -ṁ_exhaust(θ) / ω

    Enthalpy out: h_out = Cp × T_cylinder × |dm|
```

The enthalpy terms affect the energy balance of the cylinder (1st law of thermodynamics).

---

## Valve Overlap and Scavenging

During overlap (both valves open simultaneously), both intake and exhaust flows are
active. If P_intake > P_exhaust, fresh charge flows straight through the cylinder
and into the exhaust (short-circuiting). If a negative exhaust pulse arrives, the
exhaust pulls fresh charge in.

```
  Overlap period: θ_IVO to θ_EVC    (short window around exhaust TDC)
  Typical overlap: 20–40°
```

For a 0D model, the net scavenging effect is captured by computing both valve flows
simultaneously during overlap. For accurate scavenging of a multi-cylinder engine,
a 1D pipe model is needed for the exhaust system.

---

## Discharge Coefficient Correlations (When Flow Bench Data Unavailable)

Shayler et al. correlation for typical pent-roof combustion chamber:

```
  Cd(L/D) = 0.85 × (1 - exp(-15 × L/D))    (intake, typical)
  Cd(L/D) = 0.80 × (1 - exp(-12 × L/D))    (exhaust, slightly lower)
```

Accuracy: ±10–15% vs flow bench data — significantly worse than measured Cd.
If precision is required, flow bench data is essential.

---

## Accuracy vs Real Engine

| Model | Gas exchange accuracy (IMEP) | Volumetric efficiency |
|---|---|---|
| Sinusoidal lift + Shayler Cd | ±5–10% | ±8–15% |
| Sinusoidal lift + measured Cd | ±3–7% | ±5–10% |
| Measured L(θ) + measured Cd | ±2–5% | ±3–7% |
| 1D pipe + measured L + measured Cd | ±1–3% | ±2–4% |

The Cd(L) table from flow bench testing is the single most important calibration
input for the gas exchange model.
