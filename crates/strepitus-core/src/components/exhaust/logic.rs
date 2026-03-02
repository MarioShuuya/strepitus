use super::formulas as f;
use super::interface::{ExhaustConfig, ExhaustInputs, ExhaustOutputs, ExhaustState};
use crate::components::valve_train::formulas::effective_flow_area;

pub fn step(cfg: &ExhaustConfig, state: &mut ExhaustState, inputs: &ExhaustInputs) -> ExhaustOutputs {
    if inputs.exhaust_lift < 1e-6 {
        // Exhaust valve closed — reset blowdown flag when lift goes to zero
        state.blowdown_done = false;
        return ExhaustOutputs {
            exhaust_gas_temp: state.egt,
            blowdown_pressure_ratio: 1.0,
            pulse_intensity: 0.0,
            exhaust_mass_flow: 0.0,
        };
    }

    // Blowdown: first opening of exhaust valve — compute EGT
    if !state.blowdown_done {
        state.blowdown_done = true;
        let t_after = f::blowdown_temperature(
            inputs.cylinder_temperature,
            inputs.cylinder_pressure,
            cfg.ambient_pressure,
            inputs.gamma,
        );
        state.egt = f::egt_clamped(t_after);
    }

    let pr = inputs.cylinder_pressure / cfg.ambient_pressure;
    let intensity = f::pulse_intensity(inputs.cylinder_pressure, cfg.ambient_pressure, inputs.exhaust_lift);

    let cda = effective_flow_area(0.086, inputs.exhaust_lift);
    let mass_flow = f::exhaust_mass_flow(
        cda,
        inputs.cylinder_pressure,
        cfg.ambient_pressure,
        inputs.cylinder_temperature,
        inputs.gamma,
    );

    ExhaustOutputs {
        exhaust_gas_temp: state.egt,
        blowdown_pressure_ratio: pr,
        pulse_intensity: intensity,
        exhaust_mass_flow: mass_flow,
    }
}
