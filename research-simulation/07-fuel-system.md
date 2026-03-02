# Simulation — Fuel System

## What Is Simulated

The fuel system simulation computes the fuel mass delivered per cycle, the resulting
heat available for combustion, and the AFR (or lambda) at each operating point.

---

## Fuel Mass per Cycle

Given the trapped air mass m_air (from the filling model) and the target AFR:

```
  m_fuel = m_air / AFR_target

  Q_total = η_combustion × m_fuel × LHV

  where:
    η_combustion = combustion efficiency [0.80–0.95 typical]
    LHV = lower heating value of fuel [J/kg]
    AFR_target = air-fuel ratio (14.7 for stoichiometric gasoline)
```

This is the amount of chemical energy available for heat release each cycle.

### AFR Control Modes

**Stoichiometric (closed loop, λ = 1):**
```
  m_fuel = m_air / 14.7
```

**Power enrichment (WOT, λ < 1):**
```
  λ_WOT ≈ 0.85–0.92
  m_fuel = m_air / (λ_WOT × AFR_stoich)

  Effect: more fuel → more mass → more power, but lower combustion efficiency
  Also: rich mixture absorbs heat → lower peak temperature → knock resistance
```

**Lean cruise (λ > 1):**
```
  λ_lean ≈ 1.02–1.10
  m_fuel = m_air / (λ_lean × AFR_stoich)

  Effect: less fuel → lower specific power → better fuel economy
```

---

## Combustion Efficiency Model

Combustion efficiency η_c represents how much of the fuel energy is actually
released as heat (vs leaving as CO, HC, and soot):

```
  η_c = f(λ, EGR, RPM, combustion_quality)
```

Simplified model:

| Lambda | η_c |
|---|---|
| λ < 0.8 | ~0.70 (very rich, significant CO) |
| λ = 0.9 | ~0.85 |
| λ = 1.0 | ~0.92–0.95 |
| λ = 1.1 | ~0.96 |
| λ > 1.2 | ~0.95 (or drops if misfire begins) |

```
  η_c(λ) = η_max × (1 - exp(-k × (λ - λ_rich_limit)))    for λ > λ_rich_limit
```

For near-stoichiometric simulation, η_c ≈ 0.85–0.90 as a constant is adequate.
Accuracy impact: ±5% error in η_c → ±5% error in IMEP and power.

---

## Heat Release Calculation

Total heat released per cycle:

```
  Q_total = η_c × m_fuel × LHV    [J per cycle per cylinder]
```

The **rate** of heat release is governed by the combustion model (Wiebe function,
see [09-thermodynamics.md](09-thermodynamics.md)):

```
  dQ/dθ = Q_total × dx_b/dθ    [J per crank degree]
```

---

## BSFC Calculation

Brake Specific Fuel Consumption from the simulation:

```
  ṁ_fuel_total = (N_cylinders × m_fuel × RPM) / (2 × 60)    [kg/s, 4-stroke: /2 rev]

  BSFC = ṁ_fuel_total / P_brake    [kg/(W·s)] × 3.6×10⁶ → [g/kWh]

  P_brake = τ_brake × ω    [W]
```

---

## Fuel Property Database

For simulation, use measured or well-established values:

| Fuel | LHV [MJ/kg] | Stoich AFR | Density [kg/m³] | H/C ratio |
|---|---|---|---|---|
| Gasoline (typical) | 43.5–44.5 | 14.7 | 720–750 | 1.87 |
| E10 | 42.0 | 14.1 | 730–755 | 1.82 |
| E85 | 29.2 | 9.76 | 775–785 | 2.53 |
| Diesel | 42.5–43.0 | 14.5 | 820–840 | 1.81 |
| Methanol | 19.9 | 6.47 | 791 | 4.00 |

The H/C ratio determines the stoichiometric AFR exactly:
```
  AFR_stoich = (1 + H/C × 0.0689) × 3.5 × (12 + H/C) / (12 + H/C × 1.008)
  (Approximate; exact from elemental balance)
```

---

## Injection Timing Effect (GDI)

In a direct injection simulation, the timing of fuel injection affects:
- Charge cooling (evaporation absorbs heat → denser charge)
- Mixture stratification (impacts combustion rate and knock)

A simplified model applies a charge cooling correction:

```
  T_charge_GDI = T_charge_PFI - ΔT_cooling

  ΔT_cooling = m_fuel × h_vap / (m_air × Cp_air + m_fuel × Cp_fuel)

  h_vap_gasoline ≈ 350 kJ/kg (latent heat of vaporisation)
  ΔT_cooling ≈ 2–8°C for typical GDI at stoichiometric
```

Charge cooling increases effective CR by ~0.3–0.8 units equivalent.

---

## Accuracy vs Measured Data

| Quantity | Model accuracy |
|---|---|
| Fuel mass per cycle | ±1–2% (limited by m_air accuracy) |
| BSFC | ±3–5% (dominated by friction and combustion model) |
| Lambda at a given injection duration | ±1–2% |
| Effect of enrichment on power | ±2–4% |
