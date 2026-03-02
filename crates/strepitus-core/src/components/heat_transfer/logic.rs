use super::formulas as f;
use super::interface::{HeatTransferConfig, HeatTransferInputs, HeatTransferOutputs, WallState};

pub fn step(
    cfg: &HeatTransferConfig,
    state: &mut WallState,
    inputs: &HeatTransferInputs,
) -> HeatTransferOutputs {
    let h = f::woschni_h(
        cfg.bore,
        inputs.cylinder_pressure,
        inputs.gas_temperature,
        inputs.mean_piston_speed,
        inputs.pressure_motored,
        inputs.displacement_volume,
        inputs.tdc_pressure,
        inputs.tdc_temperature,
        inputs.cylinder_volume,
        cfg.woschni_c1,
        cfg.woschni_c2,
    );

    let area = f::surface_area(cfg.bore, inputs.cylinder_volume);
    let q_gas = f::q_gas_to_wall(h, area, inputs.gas_temperature, state.wall_temperature, inputs.dt);
    let q_cool = f::q_wall_to_coolant(cfg.bore, cfg.stroke, state.wall_temperature, cfg.coolant_temperature, inputs.dt);

    // Update wall temperature
    state.wall_temperature = f::wall_temp_ode(
        state.wall_temperature,
        q_gas,
        q_cool,
        cfg.wall_thermal_mass,
        inputs.dt,
    );

    HeatTransferOutputs {
        q_gas_to_wall: q_gas,
        q_wall_to_coolant: q_cool,
        h_woschni: h,
    }
}
