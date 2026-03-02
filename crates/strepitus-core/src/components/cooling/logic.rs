use super::formulas as f;
use super::interface::{CoolingConfig, CoolingInputs, CoolingOutputs, CoolingState};

pub fn step(cfg: &CoolingConfig, state: &mut CoolingState, inputs: &CoolingInputs) -> CoolingOutputs {
    let opening = f::thermostat_opening(
        state.coolant_temperature,
        cfg.thermostat_open_temp,
        cfg.thermostat_full_open_temp,
    );

    let q_rad = f::radiator_heat_rejection(
        cfg.radiator_effectiveness,
        opening,
        cfg.radiator_c_min,
        state.coolant_temperature,
        cfg.ambient_temperature,
    );

    let t_new = f::coolant_temp_ode(
        state.coolant_temperature,
        inputs.q_wall_to_coolant,
        q_rad * inputs.dt, // Q_rad is W, convert to J per step
        cfg.coolant_mass,
        cfg.coolant_cp,
        inputs.dt,
    );

    state.coolant_temperature = t_new;

    CoolingOutputs {
        coolant_temperature: t_new,
        thermostat_opening: opening,
        q_radiator: q_rad,
    }
}
