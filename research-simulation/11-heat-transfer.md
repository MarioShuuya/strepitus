# Simulation — Heat Transfer

## What Is Simulated

In-cylinder heat transfer from the hot gas to the cylinder walls. Heat lost to the
walls reduces IMEP and affects gas temperature. The wall temperature itself evolves
slowly over many cycles. This model is one of the most important for matching
simulated to measured IMEP and gas temperature.

---

## Woschni Correlation (Industry Standard)

The Woschni (1967) correlation is used in virtually all 0D and 1D engine simulation
codes, including GT-Power, AVL BOOST, and Ricardo WAVE:

```
  h_gas(θ) = 3.26 × B^(-0.2) × P^0.8 × T^(-0.55) × w^0.8    [W/(m²·K)]

  where:
    B = cylinder bore [m]
    P = cylinder pressure [Pa]
    T = mean gas temperature [K]
    w = characteristic gas velocity [m/s]
```

### Characteristic Velocity w

```
  During gas exchange and compression:
    w = C₁ × v_mean_piston = 2.28 × v_mean_piston

  During combustion and expansion:
    w = C₁ × v_mean_piston + C₂ × (Vd × T_ref) / (P_ref × V_ref) × (P - P_motored)

    C₁ = 6.18 (during gas exchange), 2.28 (compression/expansion)
    C₂ = 3.24×10⁻³ (during combustion and expansion only)

    P_motored = P_ref × (V_ref/V)^γ    (isentropic baseline pressure without combustion)
    P_ref, V_ref, T_ref = state at start of combustion (or at IVC)
```

The C₂ term captures the additional turbulence created by the combustion event —
this dramatically increases heat transfer at TDC when combustion is occurring.

### Heat Transfer Rate

```
  Q̇_wall(θ) = h_gas(θ) × A(θ) × (T_gas(θ) - T_wall)    [W]

  Per crank degree:
  dQ_wall/dθ = Q̇_wall / ω    [J/rad × 180/π → J/degree]

  A(θ) = 2 × A_piston + π × bore × x(θ)    (see geometry model)
```

---

## Alternative Correlations

### Hohenberg (1979)

A modification of Woschni better suited for diesel engines but also used for gasoline:

```
  h_gas = 130 × V^(-0.06) × P^0.8 × T^(-0.4) × (v_mean + 1.4)^0.8

  Differences from Woschni:
  - Volume V instead of bore B
  - Adds 1.4 m/s to mean piston speed (captures residual swirl)
  - No combustion-specific term (simpler)
```

### Annand (1963)

Used in early engine codes, still referenced:

```
  q̇_wall = a × k_gas / B × Re^b × (T_gas - T_wall)
            + c × σ × (T_gas⁴ - T_wall⁴)

  Re = ρ × v_mean × B / η    (Reynolds number)
  k_gas = thermal conductivity of gas
  σ = Stefan-Boltzmann constant
  a ≈ 0.26, b ≈ 0.7, c ≈ 0 (gasoline, small radiation contribution)
```

Annand explicitly separates convection and radiation terms.

### Comparison of Correlations

| Correlation | Calibration constants | Typical IMEP error vs measured |
|---|---|---|
| Woschni (default C₁=3.26) | None needed | ±5–10% |
| Woschni (calibrated C₁) | C₁ one parameter | ±2–5% |
| Hohenberg | None (generally) | ±4–8% |
| Annand (calibrated) | a, b two parameters | ±3–6% |

Woschni with calibrated C₁ is the most commonly used.

---

## Wall Thermal Model (Lumped)

The wall temperature evolves over many engine cycles via the lumped thermal model:

```
  C_wall × dT_wall/dt = Q̇_gas→wall_avg - Q̇_wall→coolant

  Q̇_gas→wall_avg = h_gas_avg × A_avg × (T_gas_avg - T_wall)
  Q̇_wall→coolant = (T_wall - T_coolant) / R_wall_thermal

  R_wall_thermal = t_wall / (k_wall × A) + 1 / (h_coolant × A)

  C_wall = ρ_wall × Cp_wall × A × t_wall    [J/K]
```

**Time constants:**
```
  τ_wall = C_wall / (1/R_thermal)

  Cast iron liner (~5mm, 500 cm² area):
  C_wall ≈ 7200 × 500 × 0.005 × 0.05 = 900 J/K
  R_thermal ≈ t_wall/(k×A) + 1/(h_cool×A) ≈ 0.002/(50×0.05) + 1/(3000×0.05) = 0.00147 K/W
  τ_wall ≈ 900 × 0.00147 ≈ 1.3 s → ~many engine cycles
```

In steady-state simulation, T_wall can be computed as a fixed point:

```
  T_wall_steady = (h_gas_avg × A × T_gas_avg + T_coolant / R_thermal) /
                  (h_gas_avg × A + 1 / R_thermal)
```

---

## Cycle-Average vs Crank-Resolved

**Crank-resolved:** compute Q̇_wall(θ) at each step using instantaneous P, T, and h_gas(θ).
This is how the 1st law energy balance is done.

**Cycle-average:** sum all dQ_wall/dθ around the cycle to get total heat loss per cycle.
Compare against measured coolant heat rejection for calibration.

---

## Calibration Procedure

```
  1. From dyno test: measure Q̇_coolant and Q̇_exhaust
  2. From combustion analyser: measure IMEP and compute heat release
  3. Energy balance: Q̇_wall = Q̇_fuel - P_indicated - Q̇_exhaust
  4. Run simulation at same operating point
  5. Adjust C₁ (Woschni) until simulated total wall heat loss matches measured Q̇_wall
  6. Verify: IMEP_simulated matches IMEP_measured to within ±2%
```

---

## Accuracy vs Measured Data

| Quantity | Uncalibrated Woschni | Calibrated Woschni |
|---|---|---|
| Total heat rejection | ±15–25% | ±3–8% |
| IMEP impact | ±3–8% | ±1–3% |
| Wall temperature at SS | ±20–50 K | ±5–15 K |
| Cycle-resolved heat flux | ±20–30% peak | ±10–20% peak |
