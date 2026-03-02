pub struct CoolingConfig {
    pub coolant_mass: f64,           // kg
    pub coolant_cp: f64,             // J/(kg·K)
    pub radiator_effectiveness: f64, // ε [0, 1]
    pub radiator_c_min: f64,         // W/K (NTU-effectiveness C_min)
    pub thermostat_open_temp: f64,   // K — thermostat starts to open
    pub thermostat_full_open_temp: f64, // K — thermostat fully open
    pub ambient_temperature: f64,   // K
    pub initial_coolant_temp: f64,  // K
}

pub struct CoolingInputs {
    /// Total heat from cylinder walls to coolant this step (sum over all cylinders), J.
    pub q_wall_to_coolant: f64,
    pub dt: f64,
}

pub struct CoolingOutputs {
    pub coolant_temperature: f64,
    pub thermostat_opening: f64, // [0, 1]
    pub q_radiator: f64,         // W — heat rejected to air
}

pub struct CoolingState {
    pub coolant_temperature: f64,
}

impl CoolingState {
    pub fn new(initial_temp: f64) -> Self {
        Self { coolant_temperature: initial_temp }
    }
}
