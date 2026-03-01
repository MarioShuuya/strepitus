use crate::engine::config::EngineConfig;

/// Combined Coulomb + viscous friction model for piston rings.
///
/// F_friction = μ · F_normal + c_v · v
///
/// Where:
/// - μ = ring friction coefficient (Coulomb)
/// - F_normal = cylinder pressure × ring contact area (approximation)
/// - c_v = viscous friction coefficient
/// - v = piston velocity
pub fn piston_friction_force(
    config: &EngineConfig,
    cylinder_pressure: f64,
    piston_velocity: f64,
) -> f64 {
    // Ring contact area approximation: bore circumference × ring width (~2mm typical)
    let ring_width = 0.002; // 2mm
    let ring_contact_area = std::f64::consts::PI * config.bore * ring_width;

    // Normal force from gas pressure on rings
    let normal_force = cylinder_pressure * ring_contact_area;

    // Coulomb friction
    let coulomb = config.ring_friction_coefficient * normal_force;

    // Viscous friction (proportional to velocity)
    let viscous = config.viscous_friction * piston_velocity.abs();

    // Total friction opposes motion
    let total = coulomb + viscous;
    if piston_velocity >= 0.0 {
        -total
    } else {
        total
    }
}

/// Stribeck-curve bearing friction torque.
/// Boundary friction dominates at low speed (realistic starter load ~1.8 N·m),
/// minimum at moderate RPM, rising quadratically at high RPM.
pub fn bearing_friction_torque(omega: f64) -> f64 {
    let w = omega.abs();
    let boundary = 1.5 * (-w / 10.0).exp(); // boundary friction, decays with speed
    let hydrodynamic_min = 0.5; // minimum friction floor (matches accessories + oil drag)
    let viscous = 1.5e-6 * w * w; // quadratic viscous rise at high RPM
    -(boundary + hydrodynamic_min + viscous)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> EngineConfig {
        EngineConfig::default()
    }

    #[test]
    fn friction_opposes_positive_velocity() {
        let cfg = default_config();
        let f = piston_friction_force(&cfg, 101_325.0, 5.0);
        assert!(f < 0.0, "Friction must oppose positive velocity, got {f}");
    }

    #[test]
    fn friction_opposes_negative_velocity() {
        let cfg = default_config();
        let f = piston_friction_force(&cfg, 101_325.0, -5.0);
        assert!(f > 0.0, "Friction must oppose negative velocity, got {f}");
    }

    #[test]
    fn higher_pressure_more_friction() {
        let cfg = default_config();
        let f_low = piston_friction_force(&cfg, 101_325.0, 5.0).abs();
        let f_high = piston_friction_force(&cfg, 1_000_000.0, 5.0).abs();
        assert!(f_high > f_low, "Higher pressure should increase friction");
    }

    #[test]
    fn bearing_friction_opposes_rotation() {
        let tau = bearing_friction_torque(100.0);
        assert!(tau < 0.0, "Bearing friction must oppose rotation, got {tau}");
    }

    #[test]
    fn bearing_friction_increases_with_speed() {
        let tau_slow = bearing_friction_torque(50.0).abs();
        let tau_fast = bearing_friction_torque(200.0).abs();
        assert!(tau_fast > tau_slow, "Higher speed should increase bearing friction");
    }
}
