# Testing — Thermodynamics

## What Is Tested

Thermodynamic testing extracts the in-cylinder thermodynamic state from measured
cylinder pressure. This is the bridge between the physical measurement (pressure
vs crank angle) and the thermodynamic quantities the simulation models (temperature,
heat release, work).

---

## Heat Release Analysis (First Law)

From the measured P(θ) and computed V(θ), the apparent heat release rate is:

```
  dQ_apparent/dθ = (γ/(γ-1)) × P × dV/dθ + (1/(γ-1)) × V × dP/dθ

  dQ_net/dθ = dQ_apparent/dθ - dQ_wall/dθ    (wall heat loss correction)
```

The "apparent" heat release includes crevice effects and blow-by losses. The "net"
heat release requires a wall heat transfer model (usually Woschni).

### Software Tools

- **AVL Indicom:** industry standard, full statistical analysis, Woschni correction
- **Kistler KiBox:** standalone combustion analyser
- **ETAS IndiCom:** combined with ECU calibration tools
- **Ricardo VALDYN / CMT software:** academic/research tools

All these implement the same fundamental first law analysis, differing in UI and
integration with measurement hardware.

---

## Cycle-to-Cycle Statistics

Production analysers typically process 100–300 consecutive cycles and report:

| Statistic | Typical value (stable engine) | Concern threshold |
|---|---|---|
| Mean IMEP | 500–1500 kPa | — |
| COVIMEP | < 3% | > 5% (rough running) |
| Max IMEP | — | — |
| Min IMEP | — | Below 80% of mean = partial burn |
| Misfire rate | < 0.1% | > 1% (regulated limit) |
| CA50 mean | 8–12° ATDC at MBT | — |
| CA50 std dev | < 2° | > 3° (unstable combustion) |

---

## P-V Diagram Measurement

A measured P-V diagram is obtained by plotting P(θ) vs V(θ) computed from encoder data:

```
  V(θ) = Vc + A_piston × x(θ)    [from known engine geometry + encoder]
  P(θ) = measured pressure trace

  Plot: P on y-axis vs V on x-axis → P-V diagram
```

**Area enclosed = indicated work per cycle:**
```
  W_indicated = ∮ P dV ≈ Σ(P_i × ΔV_i)    [J]

  IMEP_net = W_indicated / Vd
```

The P-V diagram visually shows:
- Compression ratio (width of diagram)
- Peak pressure and its location
- Pumping loop (intake/exhaust strokes, inner loop in net P-V diagram)
- Blowdown efficiency (how quickly pressure drops at EVO)

---

## Temperature Measurement (Gas and Wall)

### In-Cylinder Gas Temperature

Cannot be directly measured during combustion without disturbing the process.
Derived from P, V, and ideal gas law:

```
  T_gas = P × V / (m_gas × R)

  m_gas = known from filling model (measurement + MAF)
  R = R_air (or R_burned products, depending on stroke)
```

**Accuracy:** ±20–50 K (dominated by uncertainty in m_gas, pegging error in P,
and ideal gas approximation).

### Cylinder Wall Temperature

Measured with:
- **Embedded thermocouples:** K-type installed in the cylinder liner and head.
  Accuracy: ±2–3°C, response: seconds (slow thermal time constant of wall).
- **Thin-film heat flux sensor:** measures both temperature and heat flux with
  fast time response (~1 ms). Accurate but fragile. Used in research only.
  Equipment: Vatell HFM-7, Medtherm sensors.

---

## Specific Heat Ratio γ Measurement

The apparent γ during compression can be extracted from the measured P-V data:

```
  ln(P) = -γ × ln(V) + const    (isentropic compression line, log-log plot)

  Slope of log(P) vs log(V) = -γ_apparent

  Typical measured values:
    At BDC (inlet charge): γ ≈ 1.36–1.38
    At TDC after combustion: γ ≈ 1.25–1.27 (burned products, hot)
```

A more accurate analysis uses a temperature-dependent γ interpolation fitted to the
compression stroke of a motored (non-firing) engine test.

---

## Indicated vs Brake Power Verification

IMEP is measured from cylinder pressure. BMEP is measured from the dyno.
Their difference gives FMEP:

```
  FMEP = IMEP_net - BMEP

  BMEP = 2π × τ_brake × n_strokes / Vd    (dyno measurement)
  IMEP_net = ∮ P dV / Vd                   (combustion analyser)
```

Typical split for a warmed-up naturally aspirated engine:

| Component | Value [kPa] |
|---|---|
| IMEP_gross | 1100–1400 |
| PMEP (pumping) | 50–150 (load-dependent) |
| IMEP_net | 950–1350 |
| FMEP | 80–150 |
| BMEP | 870–1200 |

---

## Key Accuracy Summary

| Quantity | Measurement | Typical uncertainty |
|---|---|---|
| Apparent heat release rate | 1st law from P(θ) | ±3–5% |
| IMEP_net | Combustion analyser | ±2–3% |
| CA50 | Combustion analyser | ±0.5° |
| Wall temperature | Embedded thermocouple | ±2–3°C |
| Gas temperature (derived) | Ideal gas + P measurement | ±20–50 K |
| γ_apparent (compression) | Log-log slope | ±0.01–0.02 |
