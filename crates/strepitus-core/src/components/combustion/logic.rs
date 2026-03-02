use super::formulas as f;
use super::interface::{CombustionConfig, CombustionInputs, CombustionOutputs, CombustionState};

/// Step the combustion model one sub-step.
///
/// Uses the First Law of Thermodynamics (closed system):
///   dU = δQ_released - δQ_wall - P·dV
///   U = m·cv·T  →  T_new = T + dT
///   cv = R/(γ-1)
///
/// Pressure is updated from ideal gas law at the end.
pub fn step(
    cfg: &CombustionConfig,
    state: &mut CombustionState,
    inputs: &CombustionInputs,
) -> CombustionOutputs {
    let v1 = inputs.prev_volume;
    let v2 = inputs.volume;

    // Effective γ based on current temperature
    let gamma = {
        let g_air = f::gamma_air(state.temperature);
        let g_burned = f::gamma_burned(state.temperature);
        // Interpolate by burn fraction
        g_air * (1.0 - state.burn_fraction) + g_burned * state.burn_fraction
    };

    // Spark advance: use input override if valid, else config default
    let spark_adv = if inputs.spark_advance_deg.is_finite() && inputs.spark_advance_deg > 0.0 {
        inputs.spark_advance_deg
    } else {
        cfg.spark_advance_deg
    };

    let duration_deg = f::rpm_scaled_duration(cfg.combustion_duration_deg, inputs.rpm);

    // New burn fraction
    let xb_new = f::wiebe_burn_fraction(
        inputs.crank_angle_deg,
        spark_adv,
        duration_deg,
        cfg.wiebe_a,
        cfg.wiebe_m,
    );

    // Incremental heat release this step
    let q_total = f::total_heat_release(
        cfg.afr,
        cfg.fuel_lhv,
        cfg.combustion_efficiency,
        inputs.gas_mass,
    );
    let delta_xb = (xb_new - state.burn_fraction).max(0.0);
    let q_released = q_total * delta_xb;

    // First Law: dT from heat release, wall loss, and isentropic work
    // cv = R_air / (γ - 1)
    let cv = f::R_AIR / (gamma - 1.0);
    let m = inputs.gas_mass;

    // Isentropic temperature change from volume change
    let t_isentropic = if (v2 - v1).abs() > 1e-15 {
        state.temperature * (v1 / v2).powf(gamma - 1.0)
    } else {
        state.temperature
    };

    // Apply heat sources/sinks on top of isentropic
    let delta_t_heat = (q_released - inputs.q_wall) / (m * cv);
    let mut t_new = t_isentropic + delta_t_heat;
    t_new = t_new.max(200.0); // physical lower bound

    // Pressure from ideal gas law
    let p_new = f::ideal_gas_pressure(m, t_new, v2);
    let p_new = p_new.max(cfg.ambient_pressure * 0.5); // prevent unphysical negative pressure

    // Update state
    state.pressure = p_new;
    state.temperature = t_new;
    state.burn_fraction = xb_new;
    state.volume = v2;

    CombustionOutputs {
        pressure: p_new,
        temperature: t_new,
        burn_fraction: xb_new,
        q_released,
        gamma,
    }
}
