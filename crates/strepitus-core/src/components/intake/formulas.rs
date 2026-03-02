use std::f64::consts::PI;

const GAMMA: f64 = 1.4;
const R_AIR: f64 = 287.0;

/// Throttle orifice area for a given throttle plate opening angle.
/// Simple model: A = π/4 × d² × sin(θ_plate), where θ_plate ∈ [0°, 90°].
/// throttle_position ∈ [0, 1] maps to plate angle 0–90°.
pub fn throttle_area(throttle_diameter: f64, throttle_position: f64) -> f64 {
    let t = throttle_position.clamp(0.0, 1.0);
    // Full circle at WOT, tiny area at closed (plate never fully seals — 1% leakage)
    let min_open_fraction = 0.01_f64; // 1% always open (idle air)
    let open_fraction = min_open_fraction + (1.0 - min_open_fraction) * t;
    PI / 4.0 * throttle_diameter * throttle_diameter * open_fraction
}

/// Mass flow through throttle body using Barré de Saint-Venant.
/// Upstream = ambient; downstream = manifold.
/// Returns ṁ in kg/s (always ≥ 0 — throttle is one-way).
pub fn throttle_mass_flow(
    throttle_area: f64,
    p_ambient: f64,
    p_manifold: f64,
    t_ambient: f64,
) -> f64 {
    if throttle_area <= 0.0 || p_ambient <= 0.0 { return 0.0; }

    let cd = 0.65;
    let cda = cd * throttle_area;

    // No backflow through throttle
    let p_up = p_ambient.max(p_manifold);
    let p_dn = p_manifold.min(p_ambient);

    let pr = p_dn / p_up;
    let pr_crit = (2.0 / (GAMMA + 1.0)).powf(GAMMA / (GAMMA - 1.0));

    if pr <= pr_crit {
        // Choked
        let k = GAMMA * (2.0 / (GAMMA + 1.0)).powf((GAMMA + 1.0) / (2.0 * (GAMMA - 1.0)));
        cda * p_up * (k / (R_AIR * t_ambient)).sqrt()
    } else {
        // Unchoked
        let term = (pr.powf(2.0 / GAMMA) - pr.powf((GAMMA + 1.0) / GAMMA)).max(0.0);
        cda * p_up * (2.0 * GAMMA / ((GAMMA - 1.0) * R_AIR * t_ambient) * term).sqrt()
    }
}

/// Manifold filling-emptying ODE.
/// dp/dt = R·T/V × (ṁ_throttle - ṁ_cylinders)
/// Returns new manifold pressure after dt.
pub fn manifold_pressure_ode(
    p_manifold: f64,
    m_throttle: f64,
    m_cylinders: f64,
    manifold_volume: f64,
    t_manifold: f64,
    dt: f64,
    p_ambient: f64,
) -> f64 {
    let dp_dt = R_AIR * t_manifold / manifold_volume * (m_throttle - m_cylinders);
    let p_new = p_manifold + dp_dt * dt;
    // Clamp: manifold can't exceed ambient (no supercharging here) or go to vacuum below 2 kPa
    p_new.clamp(2000.0, p_ambient * 1.05)
}

/// Volumetric efficiency: actual trapped mass vs. ideal.
/// ηv = m_trapped / (ρ_ambient × V_displacement)
pub fn volumetric_efficiency(mass_trapped: f64, displacement_volume: f64, ambient_pressure: f64, ambient_temperature: f64) -> f64 {
    let rho_ambient = ambient_pressure / (R_AIR * ambient_temperature);
    let ideal_mass = rho_ambient * displacement_volume;
    if ideal_mass <= 0.0 { return 0.0; }
    (mass_trapped / ideal_mass).clamp(0.0, 1.5)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_area_zero_at_closed() {
        let a = throttle_area(0.044, 0.0);
        // 1% of full area — very small, non-zero
        let a_full = PI / 4.0 * 0.044 * 0.044;
        assert!(a < 0.02 * a_full, "Nearly-closed throttle area should be tiny, got {a}");
    }

    #[test]
    fn throttle_area_max_at_wot() {
        let a = throttle_area(0.044, 1.0);
        let a_full = PI / 4.0 * 0.044 * 0.044;
        assert!((a - a_full).abs() / a_full < 0.01, "WOT area should be full bore area");
    }

    #[test]
    fn throttle_area_increases_with_position() {
        let a_half = throttle_area(0.044, 0.5);
        let a_full = throttle_area(0.044, 1.0);
        assert!(a_full > a_half, "Area must increase with throttle position");
    }

    #[test]
    fn throttle_flow_positive_at_vacuum() {
        // Manifold vacuum: p_manifold < p_ambient → flow should be positive
        let a = throttle_area(0.044, 1.0);
        let m = throttle_mass_flow(a, 101325.0, 50000.0, 300.0);
        assert!(m > 0.0, "Flow must be positive when manifold is at vacuum, got {m}");
    }

    #[test]
    fn throttle_flow_zero_when_pressures_equal() {
        let a = throttle_area(0.044, 1.0);
        let m = throttle_mass_flow(a, 101325.0, 101325.0, 300.0);
        // Should be essentially zero (p_dn/p_up = 1 → unchoked with zero term)
        assert!(m.abs() < 1e-6, "Flow must be ≈ 0 when pressures equal, got {m}");
    }

    #[test]
    fn throttle_flow_nonnegative() {
        // No backflow through throttle
        let a = throttle_area(0.044, 0.5);
        let m = throttle_mass_flow(a, 101325.0, 120000.0, 300.0);
        assert!(m >= 0.0, "No backflow through throttle, got {m}");
    }

    #[test]
    fn manifold_pressure_rises_when_throttle_exceeds_demand() {
        let p0 = 80000.0;
        let p_new = manifold_pressure_ode(p0, 0.05, 0.01, 2e-3, 300.0, 0.001, 101325.0);
        assert!(p_new > p0, "Manifold pressure must rise when throttle > demand, got {p_new}");
    }

    #[test]
    fn manifold_pressure_falls_when_demand_exceeds_throttle() {
        let p0 = 101325.0;
        let p_new = manifold_pressure_ode(p0, 0.001, 0.05, 2e-3, 300.0, 0.001, 101325.0);
        assert!(p_new < p0, "Manifold pressure must fall when demand > throttle, got {p_new}");
    }

    #[test]
    fn volumetric_efficiency_realistic_at_3000rpm() {
        // Typically 85–95% NA
        let bore = 0.086;
        let stroke = 0.086;
        let vd = std::f64::consts::PI / 4.0 * bore * bore * stroke;
        let rho = 101325.0 / (287.0 * 300.0);
        let ideal = rho * vd;
        let actual = 0.90 * ideal; // 90% VE
        let etav = volumetric_efficiency(actual, vd, 101325.0, 300.0);
        assert!((etav - 0.90).abs() < 1e-6, "ηv should recover 0.90, got {etav}");
    }
}
