pub struct FrictionConfig {
    // Chen-Flynn FMEP coefficients
    pub cf_a: f64,  // Pa (constant term)
    pub cf_b: f64,  // Pa/Pa — coefficient on P_max
    pub cf_c: f64,  // Pa·s/m — coefficient on v_mean
    pub cf_d: f64,  // Pa·s²/m² — coefficient on v_mean²
    pub bore: f64,
    pub stroke: f64,
    // Petroff main bearing geometry
    pub bearing_radius: f64,   // m
    pub bearing_length: f64,   // m
    pub bearing_clearance: f64, // m
    pub bearing_count: usize,
}

pub struct FrictionInputs {
    pub piston_velocity: f64,     // m/s
    pub cylinder_pressure: f64,   // Pa
    pub omega: f64,               // rad/s
    pub peak_pressure: f64,       // Pa — cycle max pressure
    pub mean_piston_speed: f64,   // m/s = 2 × stroke × rpm/60
    pub oil_viscosity: f64,       // Pa·s (dynamic)
}

pub struct FrictionOutputs {
    /// Chen-Flynn FMEP in Pa.
    pub fmep: f64,
    /// Piston ring friction force in N (opposes motion).
    pub piston_friction_force: f64,
    /// Total bearing friction torque in N·m (opposes rotation).
    pub bearing_torque: f64,
    /// Combined friction torque contribution in N·m.
    pub total_friction_torque: f64,
}
