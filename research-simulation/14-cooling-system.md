# Simulation — Cooling System

## What Is Simulated

The cooling system sets the thermal boundary conditions for the engine — primarily
the coolant temperature and wall temperature. These affect friction, combustion
quality, volumetric efficiency, and knock threshold.

---

## Simplest Approach: Fixed Coolant Temperature

For most steady-state simulations, the coolant temperature is fixed at a known
operating value:

```
  T_coolant = 363 K (90°C)    [typical fully warmed thermostat setpoint]
```

The wall temperature then follows from the steady-state heat balance (see
[11-heat-transfer.md](11-heat-transfer.md)):

```
  T_wall = T_coolant + Q̇_gas→wall × R_wall_thermal
```

This is adequate for:
- WOT power and torque simulation
- BSFC at steady operating points
- Any simulation after the engine is fully warmed up

---

## Dynamic Coolant Temperature Model

For warm-up simulation or transient duty cycles, a lumped thermal network:

```
  C_coolant × dT_coolant/dt = Q̇_wall→coolant - Q̇_radiator - Q̇_heater_core

  C_coolant = m_coolant × Cp_coolant
  m_coolant ≈ 5–8 kg (total coolant mass in engine + pipes, not radiator)
  Cp_coolant ≈ 3400 J/(kg·K)
  → C_coolant ≈ 17,000–27,000 J/K
```

### Heat Inputs

```
  Q̇_wall→coolant = (T_wall - T_coolant) / R_wall_coolant    [W]

  R_wall_coolant = t_wall/(k_wall × A_total) + 1/(h_coolant × A_total)

  Typical R_wall_coolant ≈ 1×10⁻⁴ to 5×10⁻⁴ K/W
  → Time constant τ ≈ 17,000 × 2×10⁻⁴ = 3.4 s    (fast response to wall temp change)
```

### Radiator Heat Rejection

```
  Q̇_radiator = ε × C_min × (T_coolant - T_ambient)

  ε = radiator effectiveness (0.7–0.85)
  C_min = min(ṁ_coolant × Cp_coolant, ṁ_air × Cp_air)
```

At low speed (traffic): ε × C_min is small → T_coolant rises → thermostat modulates.
At highway: ε × C_min is large → strong cooling → T_coolant falls below setpoint.

### Thermostat Model

```
  Q̇_thermostat = f(T_coolant) × Q̇_radiator

  f(T_coolant) = 0        for T_coolant < T_open
  f(T_coolant) = (T_coolant - T_open) / (T_fullopen - T_open)    linear opening
  f(T_coolant) = 1        for T_coolant > T_fullopen

  T_open = 80–92°C, T_fullopen = T_open + 8–12°C
```

---

## Warm-Up Model

During warm-up, the coolant, oil, and block are all at ambient temperature initially.
The simulation evolves all thermal states:

```
  System of ODEs:
    dT_coolant/dt = (Q̇_wall→coolant - Q̇_radiator(T_coolant)) / C_coolant
    dT_wall/dt    = (Q̇_gas→wall - Q̇_wall→coolant(T_wall, T_coolant)) / C_wall
    dT_oil/dt     = (Q̇_friction→oil - Q̇_oil_cooler(T_oil, T_coolant)) / C_oil

  All three are coupled — wall temperature affects gas heat flux, which affects
  coolant temperature, which affects oil temperature through the oil cooler.
```

Warm-up time to reach 90°C coolant: typically 3–8 minutes depending on load.
Simulation should predict this within ±1 minute.

---

## Effect of Coolant Temperature on Engine Performance

| T_coolant | Effect on simulation |
|---|---|
| 60°C (cold) | Higher friction (~1.5× warm), lower volumetric efficiency (intake port walls hot, charge temp up), slightly more knock resistant |
| 90°C (nominal) | Normal operation |
| 105°C (hot) | End-gas temperature rises ~15 K → knock risk increases, ηv decreases further |
| 120°C (overheating) | Serious knock, head gasket risk, preignition |

---

## Knock Temperature Coupling

Wall temperature directly affects end-gas temperature at TDC:

```
  T_end_gas_TDC ≈ T_IVC × (V_IVC/V_TDC)^(γ-1) + ΔT_wall_heating

  ΔT_wall_heating ≈ 10–30 K per 100 K increase in T_wall
```

This means cooling system state must be coupled to knock model.

---

## Accuracy vs Measured Data

| Quantity | Fixed T_coolant model | Dynamic model |
|---|---|---|
| Steady-state wall temperature | ±10–20 K | ±5–15 K |
| Warm-up time to 90°C | Not applicable | ±1–2 min |
| Effect on IMEP | ±1–2% | ±1–2% (if T_coolant right) |
| BSFC during warm-up | Not modelled | ±5–10% |
