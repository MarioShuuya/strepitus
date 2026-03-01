use crate::engine::config::EngineConfig;

/// Woschni-style heat transfer coefficient (simplified).
/// Returns convective heat transfer coefficient h in W/(m²·K).
pub fn convection_coefficient(
    cylinder_pressure: f64,
    gas_temperature: f64,
    piston_velocity: f64,
    bore: f64,
) -> f64 {
    // Simplified Woschni correlation:
    // h = C · B^(-0.2) · P^0.8 · T^(-0.55) · w^0.8
    // where w is a characteristic gas velocity ≈ mean piston speed
    // NOTE: The standard Woschni constant 3.26 expects pressure in kPa,
    // so we convert from Pa to kPa before the calculation.
    let c = 3.26; // Woschni constant (P in kPa)
    let w = piston_velocity.abs().max(1.0); // Prevent zero
    let p_kpa = cylinder_pressure / 1000.0;

    c * bore.powf(-0.2)
        * p_kpa.powf(0.8)
        * gas_temperature.powf(-0.55)
        * w.powf(0.8)
}

/// Heat transfer from gas to cylinder wall per timestep.
/// Q = h · A · (T_gas - T_wall) · dt
pub fn gas_to_wall_heat_transfer(
    config: &EngineConfig,
    cylinder_pressure: f64,
    gas_temperature: f64,
    wall_temperature: f64,
    piston_velocity: f64,
    cylinder_volume: f64,
    dt: f64,
) -> f64 {
    let h = convection_coefficient(
        cylinder_pressure,
        gas_temperature,
        piston_velocity,
        config.bore,
    );

    // Approximate exposed surface area from volume and bore
    // A ≈ 2 × (π/4 × B²) + π × B × (V / (π/4 × B²))
    let bore_area = std::f64::consts::PI / 4.0 * config.bore * config.bore;
    let height = cylinder_volume / bore_area;
    let surface_area = 2.0 * bore_area + std::f64::consts::PI * config.bore * height;

    h * surface_area * (gas_temperature - wall_temperature) * dt
}

/// Wall to coolant heat transfer (simplified Newton's law of cooling).
pub fn wall_to_coolant_heat_transfer(
    config: &EngineConfig,
    wall_temperature: f64,
    dt: f64,
) -> f64 {
    // Convective coefficient for liquid coolant ~500-1000 W/(m²·K)
    let h_coolant = 750.0;
    // Approximate outer wall area
    let outer_area = std::f64::consts::PI * config.bore * config.stroke * 1.5;

    h_coolant * outer_area * (wall_temperature - config.coolant_temperature) * dt
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> EngineConfig {
        EngineConfig::default()
    }

    #[test]
    fn convection_coefficient_positive() {
        let h = convection_coefficient(101_325.0, 600.0, 5.0, 0.086);
        assert!(h > 0.0, "Convection coefficient must be positive, got {h}");
    }

    #[test]
    fn gas_to_wall_positive_when_gas_hotter() {
        let cfg = default_config();
        let q = gas_to_wall_heat_transfer(&cfg, 500_000.0, 800.0, 400.0, 5.0, 0.0003, 0.001);
        assert!(q > 0.0, "Heat should flow from hot gas to cooler wall, got {q}");
    }

    #[test]
    fn gas_to_wall_negative_when_wall_hotter() {
        let cfg = default_config();
        let q = gas_to_wall_heat_transfer(&cfg, 101_325.0, 300.0, 400.0, 5.0, 0.0003, 0.001);
        assert!(q < 0.0, "Heat should flow from hot wall to cooler gas, got {q}");
    }

    #[test]
    fn wall_to_coolant_positive_when_wall_hot() {
        let cfg = default_config();
        let q = wall_to_coolant_heat_transfer(&cfg, 450.0, 0.001);
        assert!(q > 0.0, "Heat should flow from hot wall to cooler coolant, got {q}");
    }

    #[test]
    fn wall_to_coolant_zero_at_equilibrium() {
        let cfg = default_config();
        let q = wall_to_coolant_heat_transfer(&cfg, cfg.coolant_temperature, 0.001);
        assert!(q.abs() < 1e-10, "No heat flow at equilibrium, got {q}");
    }
}
