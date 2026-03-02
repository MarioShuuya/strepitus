pub struct EcuConfig {
    /// Spark advance map — RPM axis.
    pub spark_map_rpm: Vec<f64>,
    /// Spark advance map — load axis (0–1).
    pub spark_map_load: Vec<f64>,
    /// Spark advance values (degrees BTDC) — row=RPM, col=load.
    pub spark_map_values: Vec<Vec<f64>>,
    /// Lambda target map — RPM axis.
    pub lambda_map_rpm: Vec<f64>,
    /// Lambda target map — load axis.
    pub lambda_map_load: Vec<f64>,
    /// Lambda target values (dimensionless).
    pub lambda_map_values: Vec<Vec<f64>>,
    /// Lambda PI proportional gain.
    pub lambda_pi_kp: f64,
    /// Lambda PI integral gain.
    pub lambda_pi_ki: f64,
    /// Short-term fuel trim clamp (±25% = 0.25).
    pub stft_clamp: f64,
    /// Base spark advance (degrees BTDC) — fallback when map is empty.
    pub base_spark_advance: f64,
}

pub struct EcuInputs {
    pub rpm: f64,
    pub load: f64,        // 0–1 (throttle position or manifold pressure ratio)
    pub lambda_actual: f64, // measured λ (1.0 = stoich)
}

pub struct EcuOutputs {
    pub spark_advance_deg: f64, // degrees BTDC
    pub lambda_target: f64,
    pub lambda_stft: f64, // short-term fuel trim [−0.25, +0.25]
    pub vvt_phase_deg: f64, // VVT advance (currently 0 — placeholder)
}

pub struct EcuState {
    pub stft: f64,       // short-term fuel trim (integrator state)
    pub stft_integral: f64,
}

impl EcuState {
    pub fn new() -> Self {
        Self { stft: 0.0, stft_integral: 0.0 }
    }
}
