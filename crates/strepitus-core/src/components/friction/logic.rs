use super::formulas as f;
use super::interface::{FrictionConfig, FrictionInputs, FrictionOutputs};

/// Friction is stateless — returns fresh outputs each call.
pub fn step(cfg: &FrictionConfig, inputs: &FrictionInputs) -> FrictionOutputs {
    let fmep = f::chen_flynn_fmep(
        cfg.cf_a,
        cfg.cf_b,
        cfg.cf_c,
        cfg.cf_d,
        inputs.peak_pressure,
        inputs.mean_piston_speed,
    );

    let piston_force = f::stribeck_ring_friction(
        inputs.piston_velocity,
        inputs.cylinder_pressure,
        cfg.bore,
        inputs.oil_viscosity,
    );

    let bearing_tau = f::total_bearing_torque(
        inputs.omega,
        inputs.oil_viscosity,
        cfg.bearing_radius,
        cfg.bearing_length,
        cfg.bearing_clearance,
        cfg.bearing_count,
    );

    // FMEP → torque contribution: τ_fmep = FMEP × V_d / (2π) per revolution
    let vd = std::f64::consts::PI / 4.0 * cfg.bore * cfg.bore * cfg.stroke;
    let fmep_torque = fmep * vd / (2.0 * std::f64::consts::PI);

    let total_friction_torque = -(fmep_torque + bearing_tau);

    FrictionOutputs {
        fmep,
        piston_friction_force: piston_force,
        bearing_torque: bearing_tau,
        total_friction_torque,
    }
}
