use super::formulas as f;
use super::interface::{EcuConfig, EcuInputs, EcuOutputs, EcuState};

pub fn step(cfg: &EcuConfig, state: &mut EcuState, inputs: &EcuInputs) -> EcuOutputs {
    // Spark advance from map
    let spark = if !cfg.spark_map_values.is_empty() {
        f::bilinear_interp(
            inputs.rpm,
            inputs.load,
            &cfg.spark_map_rpm,
            &cfg.spark_map_load,
            &cfg.spark_map_values,
        )
    } else {
        cfg.base_spark_advance
    };

    // Lambda target from map
    let lambda_target = if !cfg.lambda_map_values.is_empty() {
        f::bilinear_interp(
            inputs.rpm,
            inputs.load,
            &cfg.lambda_map_rpm,
            &cfg.lambda_map_load,
            &cfg.lambda_map_values,
        )
    } else {
        1.0
    };

    // Lambda PI controller (runs every step; dt implicit in ki)
    let dt = 1.0 / 60.0; // assumed ~60 Hz engine cycle for integrator
    let (stft, integral) = f::lambda_pi_step(
        inputs.lambda_actual,
        lambda_target,
        state.stft,
        state.stft_integral,
        cfg.lambda_pi_kp,
        cfg.lambda_pi_ki,
        cfg.stft_clamp,
        dt,
    );
    state.stft = stft;
    state.stft_integral = integral;

    EcuOutputs {
        spark_advance_deg: spark,
        lambda_target,
        lambda_stft: stft,
        vvt_phase_deg: 0.0,
    }
}
