use super::formulas as f;
use super::interface::{KinematicsConfig, KinematicsOutputs};

/// Compute all kinematic quantities for the current crank angle and angular velocity.
/// Stateless — returns fresh outputs each call.
pub fn step(cfg: &KinematicsConfig, crank_angle_rad: f64, omega: f64) -> KinematicsOutputs {
    let r = cfg.crank_radius;
    let l = cfg.con_rod_length;
    let lambda = cfg.rod_ratio;

    let pos  = f::piston_position(crank_angle_rad, r, l, lambda);
    let vel  = f::piston_velocity(crank_angle_rad, omega, r, lambda);
    let acc  = f::piston_accel(crank_angle_rad, omega, r, lambda);
    let vc   = f::clearance_volume(cfg.bore, cfg.stroke, cfg.compression_ratio);
    let vol  = f::cylinder_volume(pos, cfg.bore, vc);
    let phase = f::stroke_phase(crank_angle_rad);
    let arm  = f::torque_arm(crank_angle_rad, r, lambda);
    let area = f::piston_area(cfg.bore);
    let mr   = f::recip_mass(cfg.piston_mass, cfg.con_rod_mass);

    KinematicsOutputs {
        piston_position: pos,
        piston_velocity: vel,
        piston_accel: acc,
        volume: vol,
        stroke_phase: phase,
        torque_arm: arm,
        piston_area: area,
        recip_mass: mr,
    }
}
