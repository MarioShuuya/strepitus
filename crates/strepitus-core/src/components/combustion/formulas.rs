/// Specific gas constant for air in J/(kg·K).
pub const R_AIR: f64 = 287.0;

/// Temperature-dependent γ for air (JANAF linear fit).
/// γ_air = 1.4 - 8.33×10⁻⁵ × (T - 300), clamped to [1.28, 1.40].
#[inline]
pub fn gamma_air(t: f64) -> f64 {
    (1.4 - 8.33e-5 * (t - 300.0)).clamp(1.28, 1.40)
}

/// Temperature-dependent γ for burned gas (JANAF linear fit).
/// γ_burned = 1.25 - 6.67×10⁻⁵ × (T - 300), clamped to [1.15, 1.25].
#[inline]
pub fn gamma_burned(t: f64) -> f64 {
    (1.25 - 6.67e-5 * (t - 300.0)).clamp(1.15, 1.25)
}

/// Wiebe burn fraction at a given crank angle.
/// θ_spark = 360° - spark_advance_deg (converts BTDC to absolute on power stroke).
/// Returns 0 before spark, 1 after combustion window.
pub fn wiebe_burn_fraction(
    crank_angle_deg: f64,
    spark_advance_deg: f64,
    combustion_duration_deg: f64,
    a: f64,
    m: f64,
) -> f64 {
    let theta_start = 360.0 - spark_advance_deg;
    let theta_end = theta_start + combustion_duration_deg;

    if crank_angle_deg < theta_start {
        return 0.0;
    }
    if crank_angle_deg > theta_end {
        return 1.0;
    }

    let progress = (crank_angle_deg - theta_start) / combustion_duration_deg;
    1.0 - (-a * progress.powf(m + 1.0)).exp()
}

/// RPM-scaled combustion duration.
/// Real combustion takes roughly constant time → more crank degrees at high RPM.
pub fn rpm_scaled_duration(base_duration_deg: f64, rpm: f64) -> f64 {
    let scale = (rpm / 3000.0).powf(0.3);
    (base_duration_deg * scale).clamp(30.0, 90.0)
}

/// Isentropic pressure after volume change: P2 = P1 × (V1/V2)^γ.
#[inline]
pub fn isentropic_pressure(p1: f64, v1: f64, v2: f64, gamma: f64) -> f64 {
    p1 * (v1 / v2).powf(gamma)
}

/// Isentropic temperature after volume change: T2 = T1 × (V1/V2)^(γ-1).
#[inline]
pub fn isentropic_temperature(t1: f64, v1: f64, v2: f64, gamma: f64) -> f64 {
    t1 * (v1 / v2).powf(gamma - 1.0)
}

/// Pressure from ideal gas law: P = m·R·T / V.
#[inline]
pub fn ideal_gas_pressure(mass: f64, temperature: f64, volume: f64) -> f64 {
    mass * R_AIR * temperature / volume
}

/// Total heat that will be released during combustion in J.
/// Q_total = η × (m_air / AFR) × LHV
pub fn total_heat_release(afr: f64, fuel_lhv: f64, combustion_efficiency: f64, air_mass: f64) -> f64 {
    let fuel_mass = air_mass / afr;
    combustion_efficiency * fuel_mass * fuel_lhv
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gamma_air_at_300k() {
        let g = gamma_air(300.0);
        assert!((g - 1.4).abs() < 1e-6, "γ_air(300K) = {g}");
    }

    #[test]
    fn gamma_air_at_1000k() {
        // 1.4 - 8.33e-5 * 700 = 1.4 - 0.0583 = 1.3417
        let g = gamma_air(1000.0);
        assert!((g - 1.342).abs() < 0.001, "γ_air(1000K) = {g}");
    }

    #[test]
    fn gamma_air_clamped_at_high_temp() {
        let g = gamma_air(1500.0);
        assert!(g >= 1.28, "γ_air should be clamped to ≥ 1.28, got {g}");
    }

    #[test]
    fn gamma_burned_at_300k() {
        let g = gamma_burned(300.0);
        assert!((g - 1.25).abs() < 1e-6, "γ_burned(300K) = {g}");
    }

    #[test]
    fn gamma_burned_at_1000k() {
        // 1.25 - 6.67e-5 * 700 = 1.25 - 0.0467 = 1.2033
        let g = gamma_burned(1000.0);
        // Check it's lower than at 300K and in valid range
        assert!(g < 1.25, "γ_burned should decrease with temperature");
        assert!(g >= 1.15, "γ_burned should be clamped to ≥ 1.15, got {g}");
    }

    #[test]
    fn wiebe_zero_before_spark() {
        // Spark at 25° BTDC → absolute start = 360 - 25 = 335°
        let xb = wiebe_burn_fraction(300.0, 25.0, 50.0, 5.0, 2.0);
        assert_eq!(xb, 0.0, "No burn before spark at 300°");
    }

    #[test]
    fn wiebe_one_after_window() {
        let xb = wiebe_burn_fraction(400.0, 25.0, 50.0, 5.0, 2.0);
        assert_eq!(xb, 1.0, "Full burn after 385°");
    }

    #[test]
    fn wiebe_monotonically_non_decreasing() {
        let mut prev = 0.0;
        for deg in 335..=385 {
            let xb = wiebe_burn_fraction(deg as f64, 25.0, 50.0, 5.0, 2.0);
            assert!(xb >= prev - 1e-12, "Wiebe must be monotonic: {prev} → {xb} at {deg}°");
            prev = xb;
        }
    }

    #[test]
    fn wiebe_midpoint_near_half() {
        // Midpoint = 335 + 25 = 360°
        let xb = wiebe_burn_fraction(360.0, 25.0, 50.0, 5.0, 2.0);
        assert!((xb - 0.5).abs() < 0.05, "Wiebe midpoint ≈ 0.5, got {xb}");
    }

    #[test]
    fn isentropic_compression_cr10_5() {
        // T_BDC=300K, V ratio = CR = 10.5, γ=1.38
        let gamma = 1.38;
        let cr = 10.5;
        let t_tdc = isentropic_temperature(300.0, cr, 1.0, gamma);
        assert!(t_tdc > 650.0 && t_tdc < 750.0,
            "T_TDC after CR=10.5 isentropic compression should be 650–750K, got {t_tdc}");
    }

    #[test]
    fn isentropic_pressure_cr10_5() {
        let gamma = 1.38;
        let cr = 10.5;
        let p_tdc = isentropic_pressure(1.0e5, cr, 1.0, gamma);
        // 10.5^1.38 ≈ 31 bar
        assert!(p_tdc > 25.0e5 && p_tdc < 40.0e5,
            "P_TDC should be 25–40 bar, got {} bar", p_tdc / 1e5);
    }

    #[test]
    fn ideal_gas_round_trip() {
        let m = 5e-4;
        let t = 400.0;
        let v = 5e-5;
        let p = ideal_gas_pressure(m, t, v);
        let m_back = p * v / (R_AIR * t);
        assert!((m - m_back).abs() / m < 1e-10, "Ideal gas round-trip error");
    }

    #[test]
    fn heat_release_positive_and_realistic() {
        // 0.5g air, AFR=14.7, LHV=44MJ/kg, η=0.85
        let q = total_heat_release(14.7, 44e6, 0.85, 5e-4);
        assert!(q > 1000.0 && q < 2000.0, "Heat release should be 1000–2000 J, got {q}");
    }
}
