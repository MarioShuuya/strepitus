// engine.rs — Orchestrator: step loop, crankshaft ODE, N-cylinder support
//
// Data flow per sub-step (one cylinder):
//   [1] kinematics → [2] ecu → [3] intake → [4] valve_train →
//   [5] heat_transfer (pre-combustion) → [6] combustion →
//   [7] exhaust → [8] friction → torque accumulation → crankshaft ODE
//
// Lubrication and cooling run once per engine step (not per cylinder).

use crate::components::{
    combustion::{self, CombustionInputs, CombustionState},
    cooling::{self, CoolingInputs, CoolingState},
    ecu::{self, EcuInputs, EcuState},
    exhaust::{self, ExhaustInputs, ExhaustState},
    friction::{self, FrictionInputs},
    heat_transfer::{self, HeatTransferInputs, WallState},
    intake::{self, IntakeInputs, IntakeState},
    kinematics,
    lubrication::{self, LubricationInputs, LubricationState},
    valve_train::{self, ValveTrainInputs},
};
use crate::config::EngineParams;
use crate::types::{CylinderSnapshot, EngineSnapshot};

// ── Sub-step resolution ──────────────────────────────────────────────────

/// Degrees of crank rotation per sub-step.
pub const DEG_PER_SUBSTEP: f64 = 1.0;

// ── Per-cylinder runtime state ────────────────────────────────────────────

pub struct CylinderRuntime {
    pub combustion: CombustionState,
    pub wall: WallState,
    pub exhaust: ExhaustState,
    /// Cycle-max cylinder pressure (for Chen-Flynn FMEP).
    pub peak_pressure: f64,
    /// Previous cylinder volume (for isentropic step).
    pub prev_volume: f64,
    /// TDC pressure and temperature (start of compression) for Woschni C2.
    pub tdc_pressure: f64,
    pub tdc_temperature: f64,
    /// Accumulated torque for this engine step.
    pub torque_this_step: f64,
    /// Snapshot for WASM export.
    pub snapshot: CylinderSnapshot,
}

impl CylinderRuntime {
    pub fn new(params: &EngineParams, offset_rad: f64) -> Self {
        let r = params.kinematics.crank_radius;
        let l = params.kinematics.con_rod_length;
        let lambda = params.kinematics.rod_ratio;
        let pos = crate::components::kinematics::formulas::piston_position(offset_rad, r, l, lambda);
        let vc = crate::components::kinematics::formulas::clearance_volume(
            params.kinematics.bore, params.kinematics.stroke, params.kinematics.compression_ratio);
        let vol = crate::components::kinematics::formulas::cylinder_volume(pos, params.kinematics.bore, vc);

        let comb_state = CombustionState::new(
            params.combustion.ambient_pressure,
            params.combustion.ambient_temperature,
            vol,
        );
        let wall_state = WallState::new(params.heat_transfer.coolant_temperature + 20.0);
        let exhaust_state = ExhaustState::new(params.exhaust.ambient_temperature);

        CylinderRuntime {
            combustion: comb_state,
            wall: wall_state,
            exhaust: exhaust_state,
            peak_pressure: params.combustion.ambient_pressure,
            prev_volume: vol,
            tdc_pressure: params.combustion.ambient_pressure,
            tdc_temperature: params.combustion.ambient_temperature,
            torque_this_step: 0.0,
            snapshot: CylinderSnapshot::default(),
        }
    }
}

// ── Engine-level runtime state ────────────────────────────────────────────

pub struct EngineRuntime {
    pub cylinders: Vec<CylinderRuntime>,
    pub intake: IntakeState,
    pub lubrication: LubricationState,
    pub cooling: CoolingState,
    pub ecu: EcuState,
    /// Crankshaft angular velocity in rad/s.
    pub omega: f64,
    /// Crankshaft angle in radians for cylinder 0.
    pub crank_angle_rad: f64,
    /// Dyno integrator state.
    pub dyno_integral: f64,
    /// Cycle-averaged torque accumulator.
    pub cycle_torque_acc: f64,
    pub cycle_torque_count: usize,
    pub cycle_avg_torque: f64,
    /// Current throttle position [0, 1].
    pub throttle: f64,
}

impl EngineRuntime {
    pub fn new(params: &EngineParams) -> Self {
        let offsets = &params.cranktrain.firing_offsets_rad;
        let n = params.cranktrain.cylinder_count;
        let cylinders = offsets.iter().take(n)
            .map(|&off| CylinderRuntime::new(params, off))
            .collect();

        Self {
            cylinders,
            intake: IntakeState::new(params.intake.ambient_pressure, params.intake.ambient_temperature),
            lubrication: LubricationState::new(params.cooling.initial_coolant_temp - 10.0),
            cooling: CoolingState::new(params.cooling.initial_coolant_temp),
            ecu: EcuState::new(),
            omega: 0.0,
            crank_angle_rad: 0.0,
            dyno_integral: 0.0,
            cycle_torque_acc: 0.0,
            cycle_torque_count: 0,
            cycle_avg_torque: 0.0,
            throttle: 1.0,
        }
    }
}

// ── Main engine step ──────────────────────────────────────────────────────

/// Run one engine tick, advancing crank by `d_angle_rad`.
/// Returns per-cylinder snapshots and engine-level state.
pub fn step_engine(
    params: &EngineParams,
    runtime: &mut EngineRuntime,
    d_angle_rad: f64,
    dt: f64,
) -> EngineSnapshot {
    let n = params.cranktrain.cylinder_count;
    let offsets = &params.cranktrain.firing_offsets_rad;

    // Lubrication (once per engine step)
    let rpm = runtime.omega * 60.0 / (2.0 * std::f64::consts::PI);
    let lube_out = lubrication::step(
        &params.lubrication,
        &mut runtime.lubrication,
        &LubricationInputs {
            oil_temperature: runtime.cooling.coolant_temperature + 5.0,
            rpm,
        },
    );
    let oil_viscosity = lube_out.dynamic_viscosity;

    // ECU (once per engine step)
    let load = runtime.throttle;
    let lambda_actual = 1.0; // TODO: track actual lambda from combustion
    let ecu_out = ecu::step(
        &params.ecu,
        &mut runtime.ecu,
        &EcuInputs { rpm, load, lambda_actual },
    );

    // Intake manifold (once per engine step)
    // Estimate cylinder demand = current engine flow
    let cyl_demand_est = if runtime.omega > 1.0 {
        let vd = crate::components::kinematics::formulas::displacement_volume(
            params.kinematics.bore, params.kinematics.stroke);
        let freq = runtime.omega / (2.0 * std::f64::consts::PI * 2.0); // half-speed for 4-stroke
        let rho = runtime.intake.manifold_pressure / (287.0 * params.intake.ambient_temperature);
        rho * vd * freq * n as f64 * 0.85 // approximate ηv
    } else {
        0.0
    };

    let manifold_pressure_before = runtime.intake.manifold_pressure;
    let throttle = runtime.throttle;
    let intake_out = intake::step(
        &params.intake,
        &mut runtime.intake,
        &IntakeInputs {
            throttle_position: throttle,
            manifold_pressure: manifold_pressure_before,
            cylinder_demand: cyl_demand_est,
            dt,
        },
    );

    let manifold_pressure = intake_out.manifold_pressure;

    // Mean piston speed (same for all cylinders)
    let mean_piston_speed = 2.0 * params.kinematics.stroke * rpm / 60.0;

    // Per-cylinder sub-stepping
    let mut total_torque: f64 = 0.0;
    let mut total_q_wall: f64 = 0.0;
    let mut max_combustion_intensity: f64 = 0.0;
    let mut max_exhaust_intensity: f64 = 0.0;

    for (i, cyl) in runtime.cylinders.iter_mut().enumerate() {
        let crank_offset = offsets[i];
        let cyl_angle = runtime.crank_angle_rad + crank_offset;

        // [1] Kinematics
        let kin = kinematics::step(&params.kinematics, cyl_angle, runtime.omega);

        // Crank angle in degrees (for valve/combustion models — use 0–720 convention)
        let crank_deg = (cyl_angle.to_degrees() % 720.0 + 720.0) % 720.0;

        // [4] Valve train
        let valve_out = valve_train::step(
            &params.valve_train,
            &ValveTrainInputs {
                crank_angle_deg: crank_deg,
                upstream_pressure: manifold_pressure,
                downstream_pressure: cyl.combustion.pressure,
                upstream_temperature: params.intake.ambient_temperature,
            },
        );

        // During intake stroke: replenish gas mass from intake manifold
        let gas_mass_in = if valve_out.intake_lift > 1e-6 && kin.stroke_phase == 0 {
            valve_out.intake_mass_flow * dt
        } else {
            0.0
        };
        cyl.combustion.gas_mass = (cyl.combustion.gas_mass + gas_mass_in).max(1e-9);

        // During exhaust stroke: remove gas mass
        let gas_mass_out = if valve_out.exhaust_lift > 1e-6 {
            let cda = valve_out.exhaust_cda;
            let m_out = crate::components::exhaust::formulas::exhaust_mass_flow(
                cda,
                cyl.combustion.pressure,
                params.exhaust.ambient_pressure,
                cyl.combustion.temperature,
                crate::components::combustion::formulas::gamma_burned(cyl.combustion.temperature),
            );
            m_out * dt
        } else {
            0.0
        };
        cyl.combustion.gas_mass = (cyl.combustion.gas_mass - gas_mass_out).max(1e-9);

        // Track TDC conditions (start of compression stroke)
        if kin.stroke_phase == 1 && crank_deg < 182.0 {
            cyl.tdc_pressure = cyl.combustion.pressure;
            cyl.tdc_temperature = cyl.combustion.temperature;
        }

        // [5] Heat transfer
        let ht_inputs = HeatTransferInputs {
            cylinder_pressure: cyl.combustion.pressure,
            gas_temperature: cyl.combustion.temperature,
            piston_velocity: kin.piston_velocity,
            cylinder_volume: kin.volume,
            pressure_motored: crate::components::combustion::formulas::isentropic_pressure(
                cyl.tdc_pressure, cyl.tdc_pressure, cyl.combustion.pressure, 1.35
            ),
            mean_piston_speed,
            displacement_volume: crate::components::kinematics::formulas::displacement_volume(
                params.kinematics.bore, params.kinematics.stroke),
            tdc_pressure: cyl.tdc_pressure,
            tdc_temperature: cyl.tdc_temperature,
            dt,
        };
        let ht_out = heat_transfer::step(&params.heat_transfer, &mut cyl.wall, &ht_inputs);
        total_q_wall += ht_out.q_wall_to_coolant;

        // [6] Combustion (First Law ODE)
        let gas_mass_now = cyl.combustion.gas_mass;
        let prev_vol = cyl.prev_volume;
        let comb_out = combustion::step(
            &params.combustion,
            &mut cyl.combustion,
            &CombustionInputs {
                volume: kin.volume,
                prev_volume: prev_vol,
                crank_angle_deg: crank_deg,
                rpm,
                q_wall: ht_out.q_gas_to_wall,
                gas_mass: gas_mass_now,
                spark_advance_deg: ecu_out.spark_advance_deg,
            },
        );
        cyl.prev_volume = kin.volume;

        // Track peak pressure for friction
        if comb_out.pressure > cyl.peak_pressure {
            cyl.peak_pressure = comb_out.pressure;
        }
        // Reset peak pressure once per exhaust stroke
        if kin.stroke_phase == 3 && crank_deg > 540.0 {
            cyl.peak_pressure = comb_out.pressure;
        }

        // [7] Exhaust
        let exhaust_out = exhaust::step(
            &params.exhaust,
            &mut cyl.exhaust,
            &ExhaustInputs {
                cylinder_pressure: comb_out.pressure,
                cylinder_temperature: comb_out.temperature,
                exhaust_lift: valve_out.exhaust_lift,
                gamma: comb_out.gamma,
            },
        );

        // [8] Friction
        let friction_out = friction::step(
            &params.friction,
            &FrictionInputs {
                piston_velocity: kin.piston_velocity,
                cylinder_pressure: comb_out.pressure,
                omega: runtime.omega,
                peak_pressure: cyl.peak_pressure,
                mean_piston_speed,
                oil_viscosity,
            },
        );

        // Torque from gas pressure
        let gas_force = (comb_out.pressure - params.combustion.ambient_pressure) * kin.piston_area;
        let inertia_force = -kin.recip_mass * kin.piston_accel;
        let net_piston_force = gas_force + inertia_force + friction_out.piston_friction_force;
        let tau_gas = net_piston_force * kin.torque_arm;
        let tau_friction = friction_out.total_friction_torque;
        let tau_net = tau_gas + tau_friction;

        total_torque += tau_net;

        // Combustion intensity for audio
        let intensity = (comb_out.burn_fraction - cyl.snapshot.burn_fraction)
            .max(0.0)
            .min(1.0);
        if intensity > max_combustion_intensity {
            max_combustion_intensity = intensity;
        }
        if exhaust_out.pulse_intensity > max_exhaust_intensity {
            max_exhaust_intensity = exhaust_out.pulse_intensity;
        }

        // Update cylinder snapshot
        cyl.snapshot = CylinderSnapshot {
            crank_angle: cyl_angle % (4.0 * std::f64::consts::PI),
            piston_position: kin.piston_position,
            cylinder_pressure: comb_out.pressure,
            gas_temperature: comb_out.temperature,
            wall_temperature: cyl.wall.wall_temperature,
            stroke_phase: kin.stroke_phase,
            intake_valve_lift: valve_out.intake_lift,
            exhaust_valve_lift: valve_out.exhaust_lift,
            burn_fraction: comb_out.burn_fraction,
            cylinder_volume: kin.volume,
            gas_force,
            inertia_force,
            friction_force: friction_out.piston_friction_force,
            exhaust_pulse_intensity: exhaust_out.pulse_intensity,
            exhaust_gas_temp: exhaust_out.exhaust_gas_temp,
        };
    }

    // Cooling (once per engine step, accumulates wall→coolant heat from all cylinders)
    let cooling_out = cooling::step(
        &params.cooling,
        &mut runtime.cooling,
        &CoolingInputs {
            q_wall_to_coolant: total_q_wall,
            dt,
        },
    );

    // Crankshaft ODE: Iα = Στ_net - τ_load
    let tau_load = compute_load_torque(params, runtime, rpm);
    let tau_starter = starter_torque(runtime.omega);
    let alpha = (total_torque + tau_starter - tau_load) / params.cranktrain.crankshaft_inertia;
    let omega_new = runtime.omega + alpha * dt;
    let omega_clamped = omega_new
        .max(0.0)
        .min(params.dyno.max_rpm * 2.0 * std::f64::consts::PI / 60.0);
    runtime.omega = omega_clamped;

    // Advance crank angle (4π per full cycle)
    runtime.crank_angle_rad = (runtime.crank_angle_rad + d_angle_rad) % (4.0 * std::f64::consts::PI);

    // Cycle-averaged torque (update once per cycle)
    runtime.cycle_torque_acc += total_torque;
    runtime.cycle_torque_count += 1;
    let deg_per_cycle = 720.0;
    let substeps_per_cycle = (deg_per_cycle / DEG_PER_SUBSTEP) as usize;
    if runtime.cycle_torque_count >= substeps_per_cycle {
        runtime.cycle_avg_torque = runtime.cycle_torque_acc / runtime.cycle_torque_count as f64;
        runtime.cycle_torque_acc = 0.0;
        runtime.cycle_torque_count = 0;
    }

    let mechanical_noise = (rpm / 6000.0).clamp(0.0, 1.0) * 0.3;

    EngineSnapshot {
        rpm,
        total_torque,
        cycle_avg_torque: runtime.cycle_avg_torque,
        combustion_intensity: max_combustion_intensity,
        exhaust_intensity: max_exhaust_intensity,
        mechanical_noise,
        cycle_frequency: rpm / 120.0, // 4-stroke: cycles/min = RPM/2
        manifold_pressure,
        snapshots: runtime.cylinders.iter().map(|c| c.snapshot.clone()).collect(),
        coolant_temperature: cooling_out.coolant_temperature,
        oil_pressure: lube_out.oil_pressure,
        oil_viscosity,
    }
}

/// Compute load torque from dyno mode.
fn compute_load_torque(params: &EngineParams, runtime: &mut EngineRuntime, rpm: f64) -> f64 {
    let d = &params.dyno;
    match d.dyno_mode {
        0 => {
            // Speed PI: target is controlled externally; for now, idle load + base drag
            let target_rpm = 1000.0; // idle — JS sets throttle to control speed
            let err = rpm - target_rpm;
            runtime.dyno_integral += err;
            let pi = d.dyno_gain * err + d.dyno_integral_gain * runtime.dyno_integral;
            (d.idle_load_torque + pi.clamp(-50.0, 200.0)).max(0.0)
        }
        1 => {
            // Constant load
            d.dyno_load_torque
        }
        _ => {
            // Sweep (treat as constant for now — JS controls throttle during sweep)
            d.dyno_load_torque
        }
    }
}

/// Starter motor torque: delivers ~80 N·m at stall, tapering off with RPM.
fn starter_torque(omega: f64) -> f64 {
    if omega > 200.0 { return 0.0; } // starter disengages above ~1900 RPM
    let stall_torque = 80.0;
    let taper = (-omega / 50.0).exp();
    stall_torque * taper
}
