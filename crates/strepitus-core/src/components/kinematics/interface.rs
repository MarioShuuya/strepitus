/// Kinematics is stateless — pure geometry, no mutable state between steps.

pub struct KinematicsConfig {
    pub bore: f64,            // m
    pub stroke: f64,          // m
    pub con_rod_length: f64,  // m
    pub compression_ratio: f64,
    pub piston_mass: f64,     // kg
    pub con_rod_mass: f64,    // kg
    pub crank_radius: f64,    // m = stroke/2
    pub rod_ratio: f64,       // λ = crank_radius / con_rod_length
}

pub struct KinematicsOutputs {
    /// Piston position from TDC in meters (0 at TDC, stroke at BDC).
    pub piston_position: f64,
    /// Piston velocity in m/s (positive = moving toward BDC).
    pub piston_velocity: f64,
    /// Piston acceleration in m/s².
    pub piston_accel: f64,
    /// Cylinder volume in m³.
    pub volume: f64,
    /// Stroke phase: 0=intake, 1=compression, 2=power, 3=exhaust.
    pub stroke_phase: u8,
    /// Torque arm (converts piston force to crankshaft torque).
    pub torque_arm: f64,
    /// Gas pressure force multiplier (piston area) in m².
    pub piston_area: f64,
    /// Reciprocating mass in kg (piston + 1/3 con_rod).
    pub recip_mass: f64,
}
