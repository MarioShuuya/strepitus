use super::formulas as f;
use super::interface::{IntakeConfig, IntakeInputs, IntakeOutputs, IntakeState};

pub fn step(cfg: &IntakeConfig, state: &mut IntakeState, inputs: &IntakeInputs) -> IntakeOutputs {
    let area = f::throttle_area(cfg.throttle_diameter, inputs.throttle_position);
    let m_throttle = f::throttle_mass_flow(
        area,
        cfg.ambient_pressure,
        state.manifold_pressure,
        state.manifold_temperature,
    );

    let p_new = f::manifold_pressure_ode(
        state.manifold_pressure,
        m_throttle,
        inputs.cylinder_demand,
        cfg.manifold_volume,
        state.manifold_temperature,
        inputs.dt,
        cfg.ambient_pressure,
    );

    state.manifold_pressure = p_new;

    // Volumetric efficiency approximation — computed from current manifold conditions
    // This is reported for telemetry; the engine's actual ηv depends on gas trapping
    let vd = cfg.manifold_volume / 4.0; // rough single-cyl displacement placeholder
    let etav = f::volumetric_efficiency(m_throttle * inputs.dt, vd, cfg.ambient_pressure, cfg.ambient_temperature);

    IntakeOutputs {
        manifold_pressure: p_new,
        throttle_mass_flow: m_throttle,
        volumetric_efficiency: etav,
    }
}
