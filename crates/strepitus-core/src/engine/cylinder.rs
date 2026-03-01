use crate::engine::config::EngineConfig;
use crate::engine::crankshaft::Crankshaft;

/// State of a single cylinder during simulation.
#[derive(Debug, Clone)]
pub struct CylinderState {
    /// Gas pressure in Pa.
    pub pressure: f64,
    /// Gas temperature in K.
    pub temperature: f64,
    /// Wall temperature in K.
    pub wall_temperature: f64,
    /// Mass of gas in cylinder in kg.
    pub gas_mass: f64,
    /// Burn fraction [0, 1] during combustion.
    pub burn_fraction: f64,
    /// Current volume in m³.
    pub volume: f64,
    /// Previous step volume in m³ (for isentropic ratios).
    pub prev_volume: f64,
    /// Previous step burn fraction (for incremental heat release).
    pub prev_burn_fraction: f64,
}

impl CylinderState {
    pub fn new(config: &EngineConfig) -> Self {
        let volume = Crankshaft::cylinder_volume(config, 0.0);
        Self {
            pressure: config.ambient_pressure,
            temperature: config.ambient_temperature,
            wall_temperature: config.coolant_temperature,
            gas_mass: Self::initial_gas_mass(config, volume),
            burn_fraction: 0.0,
            volume,
            prev_volume: volume,
            prev_burn_fraction: 0.0,
        }
    }

    /// Calculate initial gas mass using ideal gas law: m = PV / (R_specific * T).
    fn initial_gas_mass(config: &EngineConfig, volume: f64) -> f64 {
        let r_air = 287.0;
        config.ambient_pressure * volume / (r_air * config.ambient_temperature)
    }
}
