use crate::engine::config::EngineConfig;

/// Specific gas constant for air in J/(kg·K).
pub const R_AIR: f64 = 287.0;

/// Ratio of specific heats for air (γ).
pub const GAMMA_AIR: f64 = 1.4;

/// Ratio of specific heats for combustion products.
pub const GAMMA_BURNED: f64 = 1.25;

/// Ideal gas law: P = m·R·T / V.
pub fn pressure_from_state(gas_mass: f64, temperature: f64, volume: f64) -> f64 {
    gas_mass * R_AIR * temperature / volume
}

/// Temperature from ideal gas law: T = P·V / (m·R).
pub fn temperature_from_state(gas_mass: f64, pressure: f64, volume: f64) -> f64 {
    pressure * volume / (gas_mass * R_AIR)
}

/// Isentropic (adiabatic) compression/expansion: P1·V1^γ = P2·V2^γ.
pub fn isentropic_pressure(p1: f64, v1: f64, v2: f64, gamma: f64) -> f64 {
    p1 * (v1 / v2).powf(gamma)
}

/// Isentropic temperature relation: T2 = T1 · (V1/V2)^(γ-1).
pub fn isentropic_temperature(t1: f64, v1: f64, v2: f64, gamma: f64) -> f64 {
    t1 * (v1 / v2).powf(gamma - 1.0)
}

/// Wiebe function: burn fraction as a function of crank angle.
///   x_b(θ) = 1 - exp(-a · ((θ - θ_start) / Δθ)^(m+1))
/// Returns 0 outside the combustion window.
pub fn wiebe_burn_fraction(
    crank_angle_deg: f64,
    spark_angle_deg: f64,
    combustion_duration_deg: f64,
    a: f64,
    m: f64,
) -> f64 {
    let theta_start = 360.0 - spark_angle_deg; // Convert BTDC to absolute
    let theta_end = theta_start + combustion_duration_deg;

    if crank_angle_deg < theta_start || crank_angle_deg > theta_end {
        return if crank_angle_deg > theta_end {
            1.0
        } else {
            0.0
        };
    }

    let progress = (crank_angle_deg - theta_start) / combustion_duration_deg;
    1.0 - (-a * progress.powf(m + 1.0)).exp()
}

/// Total heat released during combustion in Joules.
///   Q_total = η · m_fuel · LHV
///   m_fuel = m_air / AFR
pub fn total_heat_release(config: &EngineConfig, air_mass: f64) -> f64 {
    let fuel_mass = air_mass / config.afr;
    config.combustion_efficiency * fuel_mass * config.fuel_lhv
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ideal_gas_round_trip() {
        let mass = 0.001; // 1g of air
        let temp = 300.0;
        let volume = 0.0005;
        let pressure = pressure_from_state(mass, temp, volume);
        let temp_back = temperature_from_state(mass, pressure, volume);
        assert!((temp - temp_back).abs() < 1e-10, "Round-trip failed: {temp} -> {temp_back}");
    }

    #[test]
    fn ideal_gas_known_values() {
        // 1 mol air at STP: PV = nRT → P = mRT/V
        // m = 0.029 kg, T = 273.15K, V = 0.02241 m³ → P ≈ 101325 Pa
        let mass = 0.029;
        let temp = 273.15;
        let volume = mass * R_AIR * temp / 101325.0; // solve for V
        let pressure = pressure_from_state(mass, temp, volume);
        assert!((pressure - 101325.0).abs() < 1.0, "Expected ~101325 Pa, got {pressure}");
    }

    #[test]
    fn isentropic_compression_increases_pressure() {
        let p1 = 101325.0;
        let v1 = 0.0005;
        let v2 = v1 / 10.0; // 10:1 compression
        let p2 = isentropic_pressure(p1, v1, v2, GAMMA_AIR);
        assert!(p2 > p1, "Compression must increase pressure");
        // 10^1.4 ≈ 25.1
        let expected = p1 * (10.0_f64).powf(GAMMA_AIR);
        assert!((p2 - expected).abs() / expected < 1e-10);
    }

    #[test]
    fn isentropic_expansion_decreases_temperature() {
        let t1 = 800.0;
        let v1 = 0.00005;
        let v2 = v1 * 10.0; // expand 10x
        let t2 = isentropic_temperature(t1, v1, v2, GAMMA_AIR);
        assert!(t2 < t1, "Expansion must decrease temperature");
    }

    #[test]
    fn isentropic_identity() {
        // Compressing and expanding back should return original values
        let p1 = 101325.0;
        let v1 = 0.0005;
        let v2 = 0.00005;
        let p2 = isentropic_pressure(p1, v1, v2, GAMMA_AIR);
        let p_back = isentropic_pressure(p2, v2, v1, GAMMA_AIR);
        assert!((p1 - p_back).abs() < 0.01, "Isentropic round-trip: {p1} -> {p_back}");
    }

    #[test]
    fn wiebe_zero_before_spark() {
        let burn = wiebe_burn_fraction(300.0, 25.0, 50.0, 5.0, 2.0);
        assert_eq!(burn, 0.0, "No burn before spark");
    }

    #[test]
    fn wiebe_one_after_combustion() {
        // Spark at 25° BTDC → start at 335°, end at 385°
        let burn = wiebe_burn_fraction(400.0, 25.0, 50.0, 5.0, 2.0);
        assert_eq!(burn, 1.0, "Full burn after combustion window");
    }

    #[test]
    fn wiebe_monotonically_increasing() {
        let mut prev = 0.0;
        for deg in 335..=385 {
            let burn = wiebe_burn_fraction(deg as f64, 25.0, 50.0, 5.0, 2.0);
            assert!(burn >= prev, "Wiebe must be monotonic: {prev} -> {burn} at {deg}°");
            prev = burn;
        }
    }

    #[test]
    fn wiebe_reaches_near_one_at_end() {
        let burn = wiebe_burn_fraction(385.0, 25.0, 50.0, 5.0, 2.0);
        assert!(burn > 0.99, "Wiebe should be ~1.0 at end of window, got {burn}");
    }

    #[test]
    fn heat_release_positive() {
        let cfg = EngineConfig::default();
        let q = total_heat_release(&cfg, 0.0005); // 0.5g air
        assert!(q > 0.0, "Heat release must be positive");
        // Sanity: ~0.5g air / 14.7 AFR ≈ 34mg fuel × 44MJ/kg × 0.85 ≈ 1270 J
        assert!(q > 1000.0 && q < 2000.0, "Heat release out of range: {q} J");
    }
}
