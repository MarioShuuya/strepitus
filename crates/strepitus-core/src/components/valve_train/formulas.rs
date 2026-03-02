/// Discharge coefficient for poppet valves (empirical).
const CD: f64 = 0.65;

/// Valve curtain area per unit lift: A_ref = π × d_valve × lift.
/// For a valve diameter ≈ 0.7 × bore (typical).
pub fn valve_diameter(bore: f64) -> f64 {
    0.70 * bore
}

/// Valve curtain area: A = π × d_valve × lift.
pub fn curtain_area(valve_diameter: f64, lift: f64) -> f64 {
    std::f64::consts::PI * valve_diameter * lift
}

/// Effective flow area: Cd × A_curtain.
pub fn effective_flow_area(bore: f64, lift: f64) -> f64 {
    CD * curtain_area(valve_diameter(bore), lift)
}

/// Polynomial lift profile (cosine-based, smooth at open and close angles).
/// Returns lift in [0, max_lift] within the event window, 0 outside.
///
/// open_angle_deg and close_angle_deg are absolute crank angles (0–720°).
pub fn polynomial_lift(crank_angle_deg: f64, open_angle_deg: f64, close_angle_deg: f64, max_lift: f64) -> f64 {
    if crank_angle_deg <= open_angle_deg || crank_angle_deg >= close_angle_deg {
        return 0.0;
    }
    let duration = close_angle_deg - open_angle_deg;
    let progress = (crank_angle_deg - open_angle_deg) / duration;
    // Cosine profile: smooth start and end
    let lift = max_lift * 0.5 * (1.0 - (std::f64::consts::PI * 2.0 * progress).cos());
    lift.max(0.0)
}

/// Critical pressure ratio for isentropic flow (Barré de Saint-Venant).
/// P_cr/P_up = (2 / (γ + 1))^(γ / (γ - 1))
pub fn critical_pressure_ratio(gamma: f64) -> f64 {
    (2.0 / (gamma + 1.0)).powf(gamma / (gamma - 1.0))
}

/// Choked mass flow rate (critical, Mach 1 at throat).
/// ṁ_choked = Cd·A × P_up / √(R·T_up) × √(γ·(2/(γ+1))^((γ+1)/(γ-1)))
pub fn choked_flow_rate(cda: f64, p_upstream: f64, t_upstream: f64, gamma: f64, r_gas: f64) -> f64 {
    // k = γ × (2/(γ+1))^((γ+1)/(γ-1))  — exponent is (γ+1)/(γ-1), not divided by 2
    let k = gamma * (2.0 / (gamma + 1.0)).powf((gamma + 1.0) / (gamma - 1.0));
    cda * p_upstream * (k / (r_gas * t_upstream)).sqrt()
}

/// Unchoked (subsonic) mass flow rate.
/// ṁ = Cd·A × P_up / √(R·T_up) × √(2γ/(γ-1)) × [(P_dn/P_up)^(2/γ) - (P_dn/P_up)^((γ+1)/γ)]^0.5
pub fn unchoked_flow_rate(cda: f64, p_upstream: f64, p_downstream: f64, t_upstream: f64, gamma: f64, r_gas: f64) -> f64 {
    let pr = (p_downstream / p_upstream).clamp(1e-6, 1.0 - 1e-9);
    let term = (pr.powf(2.0 / gamma) - pr.powf((gamma + 1.0) / gamma)).max(0.0);
    cda * p_upstream * (2.0 * gamma / ((gamma - 1.0) * r_gas * t_upstream) * term).sqrt()
}

/// Select choked or unchoked flow based on pressure ratio.
/// Uses γ = 1.4 for air through valves.
pub fn valve_mass_flow(cda: f64, p_upstream: f64, p_downstream: f64, t_upstream: f64) -> f64 {
    if cda <= 0.0 || p_upstream <= 0.0 { return 0.0; }
    let gamma = 1.4;
    let r_gas = 287.0;
    let pr = p_downstream / p_upstream;
    let pr_crit = critical_pressure_ratio(gamma);
    if pr <= pr_crit {
        choked_flow_rate(cda, p_upstream, t_upstream, gamma, r_gas)
    } else {
        unchoked_flow_rate(cda, p_upstream, p_downstream, t_upstream, gamma, r_gas)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const GAMMA: f64 = 1.4;

    #[test]
    fn critical_pressure_ratio_air() {
        // (2/2.4)^3.5 = 0.5283
        let pr = critical_pressure_ratio(GAMMA);
        assert!((pr - 0.5283).abs() < 0.001, "P_cr/P_up should be ≈ 0.528, got {pr}");
    }

    #[test]
    fn choked_when_pr_below_critical() {
        // pr = 0.3 < 0.528 → should be choked
        let cda = 1e-4;
        let p_up = 101325.0;
        let p_dn = 0.3 * p_up;
        let t_up = 300.0;
        let m_choked = choked_flow_rate(cda, p_up, t_up, GAMMA, 287.0);
        let m_flow = valve_mass_flow(cda, p_up, p_dn, t_up);
        assert!((m_flow - m_choked).abs() < 1e-10, "Should be choked at pr=0.3");
    }

    #[test]
    fn flow_zero_at_equal_pressure() {
        let cda = 1e-4;
        let p = 101325.0;
        let t = 300.0;
        // pr = 1.0 is clamped to 1 - 1e-9 → term inside sqrt is ~0, so flow ≈ 0
        let m = unchoked_flow_rate(cda, p, p, t, GAMMA, 287.0);
        // Accept very small values due to floating-point clamp at 1-1e-9
        assert!(m.abs() < 1e-3, "Flow must be ≈ 0 at equal pressure, got {m}");
    }

    #[test]
    fn choked_unchoked_continuous_at_critical() {
        // Flow must be continuous at the critical pressure ratio
        let cda = 1e-4;
        let p_up = 200000.0;
        let t_up = 350.0;
        let pr_crit = critical_pressure_ratio(GAMMA);
        let p_dn_crit = pr_crit * p_up;

        let m_choked = choked_flow_rate(cda, p_up, t_up, GAMMA, 287.0);
        let m_unchoked = unchoked_flow_rate(cda, p_up, p_dn_crit, t_up, GAMMA, 287.0);
        let rel_err = ((m_choked - m_unchoked) / m_choked).abs();
        assert!(rel_err < 0.001, "Choked/unchoked discontinuity at critical: {rel_err:.4}");
    }

    #[test]
    fn polynomial_lift_zero_at_boundaries() {
        let lift_open = polynomial_lift(180.0, 180.0, 420.0, 0.010);
        let lift_close = polynomial_lift(420.0, 180.0, 420.0, 0.010);
        assert!(lift_open.abs() < 1e-10, "Lift must be 0 at open angle, got {lift_open}");
        assert!(lift_close.abs() < 1e-10, "Lift must be 0 at close angle, got {lift_close}");
    }

    #[test]
    fn polynomial_lift_max_at_midpoint() {
        let open = 180.0;
        let close = 420.0;
        let max_lift = 0.010;
        let mid = (open + close) / 2.0;
        let lift = polynomial_lift(mid, open, close, max_lift);
        assert!((lift - max_lift).abs() < 1e-9, "Lift at midpoint should = max_lift, got {lift}");
    }

    #[test]
    fn polynomial_lift_zero_outside_window() {
        let lift = polynomial_lift(100.0, 180.0, 420.0, 0.010);
        assert_eq!(lift, 0.0, "Lift must be 0 outside event window");
    }

    #[test]
    fn polynomial_lift_non_negative() {
        for deg in 0..720 {
            let lift = polynomial_lift(deg as f64, 180.0, 420.0, 0.010);
            assert!(lift >= 0.0, "Lift must be ≥ 0 at {deg}°, got {lift}");
        }
    }
}
