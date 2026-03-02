pub struct ExhaustConfig {
    pub ambient_pressure: f64,   // Pa
    pub ambient_temperature: f64, // K
}

pub struct ExhaustInputs {
    pub cylinder_pressure: f64,  // Pa — current cylinder pressure
    pub cylinder_temperature: f64, // K
    pub exhaust_lift: f64,       // m — from valve_train
    pub gamma: f64,              // current γ (from combustion)
}

pub struct ExhaustOutputs {
    /// EGT after blowdown in K (0 if exhaust valve closed).
    pub exhaust_gas_temp: f64,
    /// Blowdown pressure ratio (cylinder/ambient). 1.0 when no blowdown.
    pub blowdown_pressure_ratio: f64,
    /// Pulse intensity [0, 1] — for audio.
    pub pulse_intensity: f64,
    /// Mass flow out of cylinder through exhaust valve, kg/s.
    pub exhaust_mass_flow: f64,
}

pub struct ExhaustState {
    /// EGT tracked across the exhaust stroke in K.
    pub egt: f64,
    /// Whether we have seen the exhaust valve open this cycle.
    pub blowdown_done: bool,
}

impl ExhaustState {
    pub fn new(ambient_temperature: f64) -> Self {
        Self {
            egt: ambient_temperature,
            blowdown_done: false,
        }
    }
}
