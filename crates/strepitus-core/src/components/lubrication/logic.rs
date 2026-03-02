use super::formulas as f;
use super::interface::{LubricationConfig, LubricationInputs, LubricationOutputs, LubricationState};

pub fn step(cfg: &LubricationConfig, _state: &mut LubricationState, inputs: &LubricationInputs) -> LubricationOutputs {
    let eta = f::walther_viscosity(
        cfg.walther_eta_ref,
        cfg.walther_t_ref,
        cfg.walther_b,
        inputs.oil_temperature,
    );
    let p_oil = f::oil_pressure(inputs.rpm, cfg.pump_k, cfg.relief_pressure);

    LubricationOutputs {
        dynamic_viscosity: eta,
        oil_pressure: p_oil,
    }
}
