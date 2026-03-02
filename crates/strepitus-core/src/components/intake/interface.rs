pub struct IntakeConfig {
    pub throttle_diameter: f64,   // m
    pub manifold_volume: f64,     // m³
    pub ambient_pressure: f64,   // Pa
    pub ambient_temperature: f64, // K
}

pub struct IntakeInputs {
    pub throttle_position: f64,  // 0–1 (0=closed, 1=WOT)
    pub manifold_pressure: f64,  // Pa (current manifold state)
    pub cylinder_demand: f64,    // kg/s — total mass flow into all cylinders
    pub dt: f64,
}

pub struct IntakeOutputs {
    pub manifold_pressure: f64,    // Pa (updated)
    pub throttle_mass_flow: f64,   // kg/s through throttle body
    pub volumetric_efficiency: f64, // ηv [0, 1]
}

pub struct IntakeState {
    pub manifold_pressure: f64,
    pub manifold_temperature: f64,
}

impl IntakeState {
    pub fn new(ambient_pressure: f64, ambient_temperature: f64) -> Self {
        Self {
            manifold_pressure: ambient_pressure,
            manifold_temperature: ambient_temperature,
        }
    }
}
