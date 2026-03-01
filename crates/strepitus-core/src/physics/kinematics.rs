use crate::engine::config::EngineConfig;

/// Reciprocating inertia force on the piston.
/// F = -m_recip · a_piston
pub fn reciprocating_inertia_force(config: &EngineConfig, piston_acceleration: f64) -> f64 {
    // Reciprocating mass ≈ piston + 1/3 of connecting rod
    let m_recip = config.piston_mass + config.con_rod_mass / 3.0;
    -m_recip * piston_acceleration
}

/// Gas pressure force on the piston.
/// F = (P_cylinder - P_ambient) · A_piston
pub fn gas_force(config: &EngineConfig, cylinder_pressure: f64) -> f64 {
    let area = std::f64::consts::PI / 4.0 * config.bore * config.bore;
    (cylinder_pressure - config.ambient_pressure) * area
}

/// Convert piston force to crankshaft torque.
/// τ = F · r · sin(θ + β) / cos(β)
/// where β = arcsin(λ·sinθ)
pub fn force_to_torque(config: &EngineConfig, force: f64, crank_angle: f64) -> f64 {
    let r = config.stroke / 2.0;
    let lambda = r / config.con_rod_length;
    let sin_theta = crank_angle.sin();

    let beta = (lambda * sin_theta).asin();

    force * r * (crank_angle + beta).sin() / beta.cos()
}
