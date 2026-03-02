pub struct CombustionConfig {
    pub bore: f64,
    pub stroke: f64,
    pub compression_ratio: f64,
    pub afr: f64,
    pub fuel_lhv: f64,
    pub combustion_efficiency: f64,
    pub wiebe_a: f64,
    pub wiebe_m: f64,
    pub combustion_duration_deg: f64,
    pub spark_advance_deg: f64,
    pub ambient_pressure: f64,
    pub ambient_temperature: f64,
}

pub struct CombustionInputs {
    /// Current cylinder volume in m³.
    pub volume: f64,
    /// Previous step volume in m³.
    pub prev_volume: f64,
    /// Crank angle in degrees (0–720 for 4-stroke).
    pub crank_angle_deg: f64,
    /// RPM for duration scaling.
    pub rpm: f64,
    /// Heat lost to walls this step (from heat_transfer), in J. Positive = heat out.
    pub q_wall: f64,
    /// Gas mass in cylinder in kg.
    pub gas_mass: f64,
    /// Spark advance override in degrees BTDC (from ECU; use cfg default if NaN).
    pub spark_advance_deg: f64,
}

pub struct CombustionOutputs {
    /// New cylinder pressure in Pa.
    pub pressure: f64,
    /// New gas temperature in K.
    pub temperature: f64,
    /// Burn fraction [0, 1].
    pub burn_fraction: f64,
    /// Heat released this step in J.
    pub q_released: f64,
    /// Effective γ for this step.
    pub gamma: f64,
}

/// Mutable state persisted between steps.
pub struct CombustionState {
    pub pressure: f64,
    pub temperature: f64,
    pub burn_fraction: f64,
    pub gas_mass: f64,
    pub volume: f64,
}

impl CombustionState {
    pub fn new(ambient_pressure: f64, ambient_temperature: f64, volume: f64) -> Self {
        let gas_mass = ambient_pressure * volume / (287.0 * ambient_temperature);
        Self {
            pressure: ambient_pressure,
            temperature: ambient_temperature,
            burn_fraction: 0.0,
            gas_mass,
            volume,
        }
    }
}
