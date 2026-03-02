pub struct HeatTransferConfig {
    pub bore: f64,
    pub stroke: f64,
    /// Woschni C1 coefficient (motoring term, typically 2.28).
    pub woschni_c1: f64,
    /// Woschni C2 coefficient (firing term, typically 3.24e-3).
    pub woschni_c2: f64,
    /// Wall thermal mass in J/K (ρ·V·cp of the cylinder wall material).
    pub wall_thermal_mass: f64,
    /// Coolant (bulk) temperature in K.
    pub coolant_temperature: f64,
}

pub struct HeatTransferInputs {
    pub cylinder_pressure: f64,     // Pa
    pub gas_temperature: f64,       // K
    pub piston_velocity: f64,       // m/s (for Woschni w term)
    pub cylinder_volume: f64,       // m³
    /// Motored pressure at the same crank angle (isentropic, no combustion), Pa.
    pub pressure_motored: f64,
    pub mean_piston_speed: f64,     // m/s = 2 × stroke × RPM/60
    pub displacement_volume: f64,   // m³
    pub tdc_pressure: f64,          // Pa — pressure at start of compression
    pub tdc_temperature: f64,       // K — temperature at start of compression
    pub dt: f64,
}

pub struct HeatTransferOutputs {
    /// Heat transferred from gas to wall this step in J. Positive = gas loses heat.
    pub q_gas_to_wall: f64,
    /// Heat transferred from wall to coolant this step in J.
    pub q_wall_to_coolant: f64,
    /// Woschni convection coefficient in W/(m²·K).
    pub h_woschni: f64,
}

/// Mutable wall temperature state.
pub struct WallState {
    pub wall_temperature: f64,
}

impl WallState {
    pub fn new(initial_temp: f64) -> Self {
        Self { wall_temperature: initial_temp }
    }
}
