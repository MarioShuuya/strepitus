pub struct ValveTrainConfig {
    /// Intake valve opens N degrees before TDC (overlap end).
    pub ivo_deg: f64,
    /// Intake valve closes N degrees after BDC.
    pub ivc_deg: f64,
    /// Exhaust valve opens N degrees before BDC (power stroke end).
    pub evo_deg: f64,
    /// Exhaust valve closes N degrees after TDC.
    pub evc_deg: f64,
    pub max_intake_lift: f64,   // m
    pub max_exhaust_lift: f64,  // m
}

pub struct ValveTrainInputs {
    /// Crank angle in degrees, 0–720 for full 4-stroke cycle.
    pub crank_angle_deg: f64,
    /// Upstream pressure (intake manifold or cylinder pressure), Pa.
    pub upstream_pressure: f64,
    /// Downstream pressure (cylinder or exhaust back-pressure), Pa.
    pub downstream_pressure: f64,
    /// Upstream temperature, K.
    pub upstream_temperature: f64,
}

pub struct ValveTrainOutputs {
    pub intake_lift: f64,    // m
    pub exhaust_lift: f64,   // m
    /// Effective intake mass flow rate kg/s (positive = into cylinder).
    pub intake_mass_flow: f64,
    /// Effective exhaust mass flow rate kg/s (positive = out of cylinder).
    pub exhaust_mass_flow: f64,
    /// Flow coefficient × area for intake valve, m².
    pub intake_cda: f64,
    /// Flow coefficient × area for exhaust valve, m².
    pub exhaust_cda: f64,
}
