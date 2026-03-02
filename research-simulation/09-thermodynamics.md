# Simulation — Thermodynamics

## What Is Simulated

The cylinder thermodynamics is the core of the engine simulation. It solves the
energy balance of the cylinder gas at each crank angle step, tracking pressure,
temperature, and composition through the four strokes.

---

## The 0D Single-Zone Model

The standard approach for 0D engine simulation treats the entire cylinder contents
as a single, homogeneous zone at uniform temperature and pressure.

**State variables:**
```
  P(θ) — cylinder pressure [Pa]
  T(θ) — mean gas temperature [K]
  m(θ) — total gas mass [kg]
  V(θ) — cylinder volume [m³] (from geometry, not a state variable)
```

---

## First Law ODE (Closed Phase)

During the closed phase (intake and exhaust valves both closed):

```
  dU/dθ = δQ_combustion/dθ - δQ_wall/dθ - P × dV/dθ

  U = m × Cv × T    →    dU = m × Cv × dT    (ideal gas)

  →  dT/dθ = (dQ_comb/dθ - dQ_wall/dθ - P × dV/dθ) / (m × Cv)
```

Then update pressure from ideal gas:
```
  P = m × R × T / V
```

**Cv and R for the gas mixture:**
```
  Air (intake/compression):
    R_air = 287 J/(kg·K)
    Cv_air = R_air / (γ-1)

  Burned products (combustion/expansion):
    R_burned ≈ 290 J/(kg·K) (CO₂, H₂O, N₂ mix)
    Cv_burned = R_burned / (γ_burned - 1)

  Mixed zone (partial burn fraction x_b):
    R_mix = (1 - x_b) × R_air + x_b × R_burned
    γ_mix = (1 - x_b) × γ_air + x_b × γ_burned
```

---

## Temperature-Dependent γ (JANAF)

Using constant γ introduces ~3–5% error in peak temperature and pressure. Using
temperature-dependent γ improves accuracy to ~1–2%:

### For Unburned Air-Fuel Mixture

```
  γ_air(T) = 1.4 - 8.33×10⁻⁵ × (T - 300)    [K, valid 300–1500 K]

  Clamped: γ_air ∈ [1.28, 1.40]
```

Cp_air(T) = Cv_air + R = R × γ/(γ-1)

### For Burned Products

```
  γ_burned(T) = 1.25 - 6.67×10⁻⁵ × (T - 300)    [K]

  Clamped: γ_burned ∈ [1.15, 1.25]
```

These are linear fits to JANAF table data. For the most accurate thermodynamics,
use the NASA 7-coefficient polynomial for each species (air: N₂, O₂; products:
CO₂, H₂O, N₂, O₂ for lean; CO, H₂ also for rich):

```
  Cp/R = a1 + a2×T + a3×T² + a4×T³ + a5×T⁴    (NASA polynomial)
```

GT-Power uses species-resolved thermodynamic properties via the NASA polynomials.
For near 1:1 accuracy without that complexity, the JANAF linear fits above give
adequate results.

---

## Two-Zone Model (Advanced, Wiebe + Zones)

For more accurate combustion modelling, split the cylinder into:
- **Unburned zone:** fresh charge at isentropic temperature
- **Burned zone:** combustion products at much higher temperature

```
  Two zones share the same pressure P (instantaneous equilibrium)
  Each zone has its own temperature: T_u (unburned), T_b (burned)
  Burned fraction x_b(θ) from Wiebe
  Mass in burned zone: m_b = x_b × m_total
```

Heat release goes entirely into the burned zone. The unburned zone heats isentropically.

The two-zone model:
- Gives accurate unburned zone temperature → better knock prediction
- Gives accurate burned zone temperature → better NOx prediction (Zeldovich)
- Accuracy: ±1–2% on IMEP, ±30–50 K on peak temperatures

GT-Power, AVL BOOST, and Ricardo WAVE all implement the two-zone model as an option.

---

## Integration Algorithm

The ODE is integrated per crank degree step. At each step:

```
  1.  Compute V(θ) and dV/dθ from geometry
  2.  Compute dx_b/dθ from Wiebe (if in combustion window)
  3.  Compute dQ_comb/dθ = Q_total × dx_b/dθ
  4.  Compute dQ_wall/dθ from Woschni (see [11-heat-transfer.md](11-heat-transfer.md))
  5.  Compute dT/dθ from 1st law ODE
  6.  Update T, compute new P from ideal gas: P = m × R × T / V
  7.  Compute torque contribution from gas force
  8.  Integrate crankshaft ODE: dω/dt = τ_net / J
```

Runge-Kutta 4 is recommended for steps 1–7. Euler is adequate for the crankshaft ODE
with Δθ ≤ 0.5°.

---

## Pumping Losses (Gas Exchange Phase)

During intake and exhaust strokes:

```
  dU/dθ = δQ_wall/dθ - P × dV/dθ + h_in × dm_in/dθ - h_out × dm_out/dθ

  h = Cp × T    (specific enthalpy of incoming/outgoing gas)
```

The net pumping work per cycle:
```
  W_pumping = ∮_gas_exchange P × dV ≈ (P_exhaust - P_intake) × Vd

  At idle: P_intake ≈ 40 kPa, P_exhaust ≈ 105 kPa
  W_pumping ≈ 65 kPa × Vd ≈ 32 J for 500 cm³ cylinder
```

---

## Accuracy vs Combustion Analyser Data

| Quantity | Single-zone + JANAF γ | Two-zone model |
|---|---|---|
| IMEP | ±2–4% (calibrated) | ±1–2% |
| Peak pressure | ±3–7 bar | ±2–4 bar |
| Peak pressure location | ±1–2° | ±0.5–1° |
| CA50 | ±1–2° | ±0.5–1° |
| Mean gas temperature | ±30–60 K | ±15–30 K |
| NOx prediction | Not meaningful | ±20–40% (with Zeldovich) |

The single-zone model with calibrated Wiebe parameters and temperature-dependent γ
achieves near 1:1 accuracy on IMEP, peak pressure, and CA50.
