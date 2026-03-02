pub struct LubricationConfig {
    /// Reference dynamic viscosity (Pa·s) at T_ref (Walther equation).
    pub walther_eta_ref: f64,
    /// Reference temperature in K.
    pub walther_t_ref: f64,
    /// Walther viscosity-temperature coefficient B (K).
    pub walther_b: f64,
    /// Oil relief valve pressure in Pa.
    pub relief_pressure: f64,
    /// Oil pump flow constant: P_oil = K × RPM (before clamping at relief).
    pub pump_k: f64,
}

pub struct LubricationInputs {
    pub oil_temperature: f64, // K
    pub rpm: f64,
}

pub struct LubricationOutputs {
    pub dynamic_viscosity: f64, // Pa·s
    pub oil_pressure: f64,      // Pa
}

pub struct LubricationState {
    pub oil_temperature: f64,
}

impl LubricationState {
    pub fn new(initial_temp: f64) -> Self {
        Self { oil_temperature: initial_temp }
    }
}
