use std::f64::consts::PI;

/// Chen-Flynn FMEP (Friction Mean Effective Pressure) in Pa.
///
/// FMEP = A + B·P_max + C·v_mean + D·v_mean²
///
/// Typical coefficients for a petrol engine:
///   A = 61,000 Pa (0.61 bar)
///   B = 0.0056 (dimensionless, fraction of P_max)
///   C = 15,700 Pa·s/m (0.157 bar·s/m)
///   D = 28 Pa·s²/m² (0.0028 bar·s²/m²)
pub fn chen_flynn_fmep(a: f64, b: f64, c: f64, d: f64, p_max: f64, v_mean: f64) -> f64 {
    (a + b * p_max + c * v_mean + d * v_mean * v_mean).max(0.0)
}

/// Stribeck number (dimensionless). Distinguishes lubrication regimes.
/// Stribeck = η·n / P_contact (n = rotational speed in rev/s)
pub fn stribeck_number(viscosity: f64, rpm: f64, contact_pressure: f64) -> f64 {
    let n = rpm / 60.0;
    if contact_pressure <= 0.0 { return 0.0; }
    viscosity * n / contact_pressure
}

/// Piston ring friction force in N using Stribeck-curve model.
/// Combines boundary, mixed, and hydrodynamic regimes.
/// F > 0 when piston moves down (opposes motion = negative contribution to torque).
/// Returns signed force: negative opposes positive piston velocity.
pub fn stribeck_ring_friction(
    piston_velocity: f64,
    cylinder_pressure: f64,
    bore: f64,
    viscosity: f64,
) -> f64 {
    if piston_velocity.abs() < 1e-10 { return 0.0; }

    // Ring normal force from gas pressure
    let ring_width = 0.002; // 2mm
    let ring_contact_area = PI * bore * ring_width;
    let f_normal = cylinder_pressure * ring_contact_area;

    // Stribeck-based friction coefficient
    let omega_ring = piston_velocity.abs() / (bore / 2.0); // approximate shaft speed
    let st = stribeck_number(viscosity, omega_ring * 30.0 / PI, cylinder_pressure);
    // Typical Stribeck: μ_min at ~ Stribeck = 0.01, boundary μ ≈ 0.12 at near-zero
    let mu = (0.08 * (-st / 0.005).exp() + 0.01).clamp(0.008, 0.12);

    let coulomb = mu * f_normal;
    // Viscous drag (proportional to velocity)
    let viscous = 50.0 * viscosity * piston_velocity.abs();
    let total = coulomb + viscous;

    if piston_velocity > 0.0 { -total } else { total }
}

/// Petroff bearing friction torque per bearing in N·m.
/// τ = η·ω·π·r³·L / c
/// where r=bearing radius, L=bearing length, c=clearance, η=viscosity, ω=angular velocity.
pub fn petroff_bearing_torque(
    omega: f64,
    viscosity: f64,
    radius: f64,
    length: f64,
    clearance: f64,
) -> f64 {
    if omega.abs() < 1e-10 { return 0.0; }
    viscosity * omega.abs() * PI * radius.powi(3) * length / clearance
}

/// Total bearing friction torque for all main bearings in N·m.
pub fn total_bearing_torque(omega: f64, viscosity: f64, radius: f64, length: f64, clearance: f64, count: usize) -> f64 {
    let tau_per = petroff_bearing_torque(omega, viscosity, radius, length, clearance);
    tau_per * count as f64
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Chen-Flynn reference coefficients (bar-based)
    const A: f64 = 0.61e5; // Pa
    const B: f64 = 0.0056;
    const C: f64 = 0.157e5; // Pa·s/m
    const D: f64 = 0.0028e5; // Pa·s²/m²

    #[test]
    fn chen_flynn_idle() {
        // P_max=15 bar, v_mean=2 m/s
        let fmep = chen_flynn_fmep(A, B, C, D, 15e5, 2.0);
        // 0.61 + 0.0056×15 + 0.157×2 + 0.0028×4 = 0.61+0.084+0.314+0.011 = 1.019 bar
        let expected = 1.019e5;
        let rel_err = ((fmep - expected) / expected).abs();
        assert!(rel_err < 0.02, "Chen-Flynn idle FMEP: expected ~1.019 bar, got {} bar (err={rel_err:.3})", fmep / 1e5);
    }

    #[test]
    fn chen_flynn_wot_3000rpm() {
        // v_mean = 2×0.086×3000/60 = 8.6 m/s, P_max ≈ 60 bar
        let v = 2.0 * 0.086 * 3000.0 / 60.0;
        let fmep = chen_flynn_fmep(A, B, C, D, 60e5, v);
        // 0.61 + 0.336 + 1.35 + 0.207 ≈ 2.50 bar
        let expected = 2.50e5;
        let rel_err = ((fmep - expected) / expected).abs();
        assert!(rel_err < 0.10, "Chen-Flynn WOT 3000 RPM: expected ~2.5 bar, got {} bar", fmep / 1e5);
    }

    #[test]
    fn chen_flynn_increases_with_p_max() {
        let fmep1 = chen_flynn_fmep(A, B, C, D, 20e5, 5.0);
        let fmep2 = chen_flynn_fmep(A, B, C, D, 60e5, 5.0);
        assert!(fmep2 > fmep1, "FMEP must increase with P_max");
    }

    #[test]
    fn chen_flynn_increases_with_v_mean() {
        let fmep1 = chen_flynn_fmep(A, B, C, D, 30e5, 2.0);
        let fmep2 = chen_flynn_fmep(A, B, C, D, 30e5, 8.0);
        assert!(fmep2 > fmep1, "FMEP must increase with v_mean");
    }

    #[test]
    fn chen_flynn_always_positive() {
        let fmep = chen_flynn_fmep(A, B, C, D, 0.0, 0.0);
        assert!(fmep >= 0.0, "FMEP must be ≥ 0 even at zero load");
    }

    #[test]
    fn stribeck_ring_friction_opposes_velocity() {
        let f_pos = stribeck_ring_friction(5.0, 1e6, 0.086, 0.010);
        let f_neg = stribeck_ring_friction(-5.0, 1e6, 0.086, 0.010);
        assert!(f_pos < 0.0, "Friction must oppose positive velocity, got {f_pos}");
        assert!(f_neg > 0.0, "Friction must oppose negative velocity, got {f_neg}");
    }

    #[test]
    fn stribeck_ring_friction_zero_at_zero_velocity() {
        let f = stribeck_ring_friction(0.0, 1e6, 0.086, 0.010);
        assert_eq!(f, 0.0, "Friction must be 0 at zero velocity");
    }

    #[test]
    fn stribeck_ring_friction_increases_with_pressure() {
        let f_low = stribeck_ring_friction(5.0, 1e5, 0.086, 0.010).abs();
        let f_high = stribeck_ring_friction(5.0, 5e6, 0.086, 0.010).abs();
        assert!(f_high > f_low, "Friction must increase with cylinder pressure");
    }

    #[test]
    fn petroff_bearing_torque_at_6000rpm() {
        // r=28mm, L=25mm, c=40μm, η=0.010 Pa·s, ω=628 rad/s
        let omega = 6000.0 * 2.0 * std::f64::consts::PI / 60.0; // 628 rad/s
        let tau = petroff_bearing_torque(omega, 0.010, 0.028, 0.025, 40e-6);
        // Expected ≈ 0.27 N·m per bearing
        assert!(tau > 0.1 && tau < 0.5, "Per-bearing torque should be ~0.27 N·m, got {tau}");
    }

    #[test]
    fn total_bearing_torque_5_bearings() {
        // 5 bearings should give ~1.35 N·m total at 6000 RPM
        let omega = 6000.0 * 2.0 * std::f64::consts::PI / 60.0;
        let tau = total_bearing_torque(omega, 0.010, 0.028, 0.025, 40e-6, 5);
        // Research: "total bearing τ ≈ 2–4 N·m at 6000 RPM" — η=0.010 gives lower end
        assert!(tau > 0.5 && tau < 5.0, "Total bearing torque should be 0.5–5 N·m, got {tau}");
    }

    #[test]
    fn petroff_increases_with_omega() {
        let tau1 = petroff_bearing_torque(100.0, 0.010, 0.028, 0.025, 40e-6);
        let tau2 = petroff_bearing_torque(600.0, 0.010, 0.028, 0.025, 40e-6);
        assert!(tau2 > tau1, "Bearing torque must increase with ω");
    }

    #[test]
    fn petroff_increases_with_viscosity() {
        let tau1 = petroff_bearing_torque(300.0, 0.005, 0.028, 0.025, 40e-6);
        let tau2 = petroff_bearing_torque(300.0, 0.020, 0.028, 0.025, 40e-6);
        assert!(tau2 > tau1, "Bearing torque must increase with viscosity");
    }
}
