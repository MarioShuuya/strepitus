/// Isentropic blowdown temperature.
/// T_after = T_before × (P_ambient / P_before)^((γ-1)/γ)
pub fn blowdown_temperature(t_before: f64, p_before: f64, p_after: f64, gamma: f64) -> f64 {
    if p_before <= p_after { return t_before; }
    let exponent = (gamma - 1.0) / gamma;
    t_before * (p_after / p_before).powf(exponent)
}

/// EGT after blowdown, clamped to physical range [373 K, 2000 K].
pub fn egt_clamped(t_egt: f64) -> f64 {
    t_egt.clamp(373.0, 2000.0)
}

/// Blowdown pulse intensity [0, 1] from pressure ratio.
/// Intensity rises steeply when P_cylinder >> P_ambient.
pub fn pulse_intensity(cylinder_pressure: f64, ambient_pressure: f64, exhaust_lift: f64) -> f64 {
    if exhaust_lift <= 1e-6 { return 0.0; }
    let pr = (cylinder_pressure / ambient_pressure - 1.0).max(0.0);
    (pr / 5.0).clamp(0.0, 1.0)
}

/// Exhaust mass flow rate through the exhaust valve (kg/s).
/// Uses Barré de Saint-Venant, upstream = cylinder, downstream = ambient.
pub fn exhaust_mass_flow(cda: f64, p_cylinder: f64, p_ambient: f64, t_cylinder: f64, gamma: f64) -> f64 {
    if cda <= 0.0 || p_cylinder <= p_ambient { return 0.0; }
    let r_gas = 287.0;
    let pr = p_ambient / p_cylinder;
    let pr_crit = (2.0 / (gamma + 1.0)).powf(gamma / (gamma - 1.0));
    if pr <= pr_crit {
        // Choked: k = γ × (2/(γ+1))^((γ+1)/(γ-1))
        let k = gamma * (2.0 / (gamma + 1.0)).powf((gamma + 1.0) / (gamma - 1.0));
        cda * p_cylinder * (k / (r_gas * t_cylinder)).sqrt()
    } else {
        let term = (pr.powf(2.0 / gamma) - pr.powf((gamma + 1.0) / gamma)).max(0.0);
        cda * p_cylinder * (2.0 * gamma / ((gamma - 1.0) * r_gas * t_cylinder) * term).sqrt()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blowdown_temperature_drops() {
        // T=1800K, P=8bar → 1bar, γ=1.28
        let t_after = blowdown_temperature(1800.0, 8e5, 1e5, 1.28);
        assert!(t_after < 1800.0, "Blowdown must reduce temperature");
        // 1800 × (1/8)^(0.28/1.28) ≈ 1800 × 0.125^0.219 ≈ 1107 K
        assert!(t_after > 900.0 && t_after < 1300.0,
            "Blowdown T expected ~1100 K, got {t_after}");
    }

    #[test]
    fn blowdown_temperature_no_change_at_ambient() {
        let t = blowdown_temperature(500.0, 1e5, 1e5, 1.35);
        assert!((t - 500.0).abs() < 1e-10, "No T drop at ambient pressure, got {t}");
    }

    #[test]
    fn egt_clamped_range() {
        assert_eq!(egt_clamped(200.0), 373.0, "EGT must be clamped to min");
        assert_eq!(egt_clamped(3000.0), 2000.0, "EGT must be clamped to max");
        assert!((egt_clamped(1000.0) - 1000.0).abs() < 1e-10);
    }

    #[test]
    fn egt_realistic_wot() {
        // WOT EGT: 700–950°C = 973–1223 K
        let egt_wot = egt_clamped(1100.0);
        assert!(egt_wot > 973.0 && egt_wot < 1223.0, "WOT EGT = {egt_wot} K");
    }

    #[test]
    fn pulse_intensity_zero_when_valve_closed() {
        let intensity = pulse_intensity(5e5, 1e5, 0.0);
        assert_eq!(intensity, 0.0, "Pulse must be 0 when valve closed");
    }

    #[test]
    fn pulse_intensity_nonzero_when_high_pressure() {
        let intensity = pulse_intensity(5e5, 1e5, 0.005);
        assert!(intensity > 0.0, "Pulse must be nonzero at high cylinder pressure");
    }

    #[test]
    fn exhaust_mass_flow_zero_when_no_pressure_diff() {
        let m = exhaust_mass_flow(1e-4, 1e5, 1e5, 1000.0, 1.35);
        assert!(m.abs() < 1e-10, "No flow when P_cyl = P_amb, got {m}");
    }

    #[test]
    fn exhaust_mass_flow_positive_when_high_pressure() {
        let m = exhaust_mass_flow(1e-4, 5e5, 1e5, 1500.0, 1.35);
        assert!(m > 0.0, "Flow must be positive when P_cyl > P_amb, got {m}");
    }
}
