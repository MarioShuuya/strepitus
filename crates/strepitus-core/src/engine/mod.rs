pub mod config;
pub mod crankshaft;
pub mod cylinder;
pub mod valve;

use crate::audio::AudioParams;
use crate::physics::{friction, heat, kinematics, thermo};
use crate::types::{CylinderSnapshot, MultiCylinderState, SimulationState};
use config::EngineConfig;
use crankshaft::Crankshaft;
use cylinder::CylinderState;
use valve::ValveTrain;
use wasm_bindgen::prelude::*;

// ── Free function: step a single cylinder ──────────────────────────

/// Result of stepping one cylinder for one sub-step.
struct CylinderStepResult {
    snapshot: CylinderSnapshot,
    torque_piston: f64,
}

/// Cylinder wall thermal capacity in J/K (cast iron).
fn wall_thermal_cap(config: &EngineConfig) -> f64 {
    let wall_thickness = 0.005; // 5 mm
    let density = 7200.0; // cast iron kg/m³
    let cp = 500.0; // J/(kg·K)
    let wall_volume = std::f64::consts::PI * config.bore * config.stroke * wall_thickness;
    density * wall_volume * cp
}

/// Compute intake manifold pressure based on throttle position.
/// At fully closed throttle (t=0), manifold pressure drops to ~5% of ambient
/// (~5 kPa), representing a nearly sealed throttle plate with minimal leakage.
/// This causes strong engine braking (pumping losses exceed combustion work).
fn manifold_pressure(throttle: f64, ambient: f64) -> f64 {
    let t = throttle.clamp(0.0, 1.0);
    let min_ratio = 0.05; // ~5 kPa at closed throttle — deep vacuum
    ambient * (min_ratio + (1.0 - min_ratio) * t.sqrt())
}

/// Starter motor torque. Cranks the engine when RPM is below cranking speed
/// and the starter is engaged. Delivers ~80 N·m at stall (realistic for a
/// small-engine starter motor ~1.2 kW), tapering off as RPM rises.
/// Returns 0 if the starter is not engaged or RPM is above cranking speed.
fn starter_torque(omega: f64, starter_engaged: bool) -> f64 {
    let cranking_rpm = 300.0;
    let cranking_omega = cranking_rpm * 2.0 * std::f64::consts::PI / 60.0;
    if !starter_engaged || omega > cranking_omega {
        return 0.0;
    }
    // Taper: full torque at 0 RPM, zero at cranking_omega
    let ratio = (omega / cranking_omega).clamp(0.0, 1.0);
    80.0 * (1.0 - ratio)
}

/// Step a single cylinder through one physics sub-step.
/// `crank_angle` is the 4-stroke angle [0, 4π) for THIS cylinder (already offset).
/// `manifold_p` is the intake manifold pressure (throttle-dependent).
/// Returns per-cylinder snapshot and the piston torque contribution.
fn step_cylinder(
    config: &EngineConfig,
    cyl: &mut CylinderState,
    crank_angle: f64,
    omega: f64,
    dt: f64,
    manifold_p: f64,
) -> CylinderStepResult {
    use std::f64::consts::PI;

    // Piston kinematics (piston repeats every 2π)
    let piston_angle = crank_angle % (2.0 * PI);
    let piston_pos = Crankshaft::piston_position(config, piston_angle);
    let piston_vel = Crankshaft::piston_velocity(config, piston_angle, omega);
    let piston_accel = Crankshaft::piston_acceleration(config, piston_angle, omega);

    // Cylinder volume
    let new_volume = Crankshaft::cylinder_volume(config, piston_angle);
    let prev_volume = cyl.prev_volume;

    // Stroke phase (in 720° / 4-stroke cycle)
    let crank_deg = crank_angle.to_degrees();
    let stroke_phase: u8 = if crank_deg < 180.0 {
        0 // Intake
    } else if crank_deg < 360.0 {
        1 // Compression
    } else if crank_deg < 540.0 {
        2 // Power
    } else {
        3 // Exhaust
    };

    // Save pre-capture blowdown state for event detection
    let pre_blowdown_pressure = cyl.blowdown_pressure;

    // Thermodynamic state update by stroke phase
    match stroke_phase {
        0 => {
            cyl.pressure = manifold_p;
            cyl.temperature = config.ambient_temperature;
            cyl.gas_mass = manifold_p * new_volume
                / (thermo::R_AIR * config.ambient_temperature);
            cyl.burn_fraction = 0.0;
            cyl.prev_burn_fraction = 0.0;
            // Reset blowdown state for next cycle
            cyl.blowdown_pressure = config.ambient_pressure;
            cyl.blowdown_temperature = config.ambient_temperature;
        }
        1 | 2 => {
            let rpm = omega * 60.0 / (2.0 * std::f64::consts::PI);
            let eff_duration = thermo::rpm_scaled_combustion_duration(
                config.combustion_duration, rpm,
            );
            let burn = thermo::wiebe_burn_fraction(
                crank_deg,
                config.spark_advance,
                eff_duration,
                config.wiebe_a,
                config.wiebe_m,
            );
            let delta_burn = (burn - cyl.prev_burn_fraction).max(0.0);
            let g_air = thermo::gamma_air_temp(cyl.temperature);
            let g_burned = thermo::gamma_burned_temp(cyl.temperature);
            let gamma = g_air * (1.0 - burn) + g_burned * burn;

            if prev_volume > 0.0 && new_volume > 0.0 {
                cyl.temperature = thermo::isentropic_temperature(
                    cyl.temperature,
                    prev_volume,
                    new_volume,
                    gamma,
                );
            }

            if delta_burn > 0.0 && cyl.gas_mass > 0.0 {
                let q_total = thermo::total_heat_release(config, cyl.gas_mass);
                let q_step = q_total * delta_burn;
                let cv = thermo::R_AIR / (gamma - 1.0);
                cyl.temperature += q_step / (cyl.gas_mass * cv);
            }

            cyl.pressure =
                thermo::pressure_from_state(cyl.gas_mass, cyl.temperature, new_volume);
            cyl.burn_fraction = burn;
            cyl.prev_burn_fraction = burn;
        }
        _ => {
            // Exhaust stroke: blowdown decay instead of snap-to-ambient
            // Capture blowdown conditions at start of exhaust (pressure still elevated)
            if cyl.pressure > config.ambient_pressure * 1.1 && cyl.blowdown_pressure <= config.ambient_pressure * 1.1 {
                cyl.blowdown_pressure = cyl.pressure;
                cyl.blowdown_temperature = cyl.temperature;
            }

            // Exponential pressure decay toward ambient
            let exhaust_lift = ValveTrain::exhaust_lift(config, crank_deg);
            let lift_fraction = (exhaust_lift / config.max_exhaust_lift).clamp(0.01, 1.0);
            let tau_blowdown = 0.002 / lift_fraction;
            let decay_factor = (-dt / tau_blowdown).exp();
            cyl.pressure = config.ambient_pressure + (cyl.pressure - config.ambient_pressure) * decay_factor;

            // Temperature also decays toward ambient
            let temp_tau = tau_blowdown * 3.0; // slower thermal equilibrium
            let temp_decay = (-dt / temp_tau).exp();
            cyl.temperature = config.ambient_temperature + (cyl.temperature - config.ambient_temperature) * temp_decay;

            cyl.gas_mass = cyl.pressure * new_volume
                / (thermo::R_AIR * cyl.temperature);
            cyl.burn_fraction = 0.0;
            cyl.prev_burn_fraction = 0.0;
        }
    }

    // Heat transfer
    let gamma = match stroke_phase {
        1 | 2 => {
            let g_a = thermo::gamma_air_temp(cyl.temperature);
            let g_b = thermo::gamma_burned_temp(cyl.temperature);
            g_a * (1.0 - cyl.burn_fraction) + g_b * cyl.burn_fraction
        }
        3 => thermo::gamma_burned_temp(cyl.temperature),
        _ => thermo::gamma_air_temp(cyl.temperature),
    };
    let cv = thermo::R_AIR / (gamma - 1.0);

    let q_gas_wall = heat::gas_to_wall_heat_transfer(
        config,
        cyl.pressure,
        cyl.temperature,
        cyl.wall_temperature,
        piston_vel,
        new_volume,
        dt,
    );

    if cyl.gas_mass > 0.0 {
        cyl.temperature -= q_gas_wall / (cyl.gas_mass * cv);
        cyl.temperature = cyl.temperature.max(config.ambient_temperature);
    }

    match stroke_phase {
        0 => {
            cyl.pressure = manifold_p;
            cyl.gas_mass = manifold_p * new_volume
                / (thermo::R_AIR * cyl.temperature);
        }
        3 => {
            // Post-heat-transfer exhaust: continue blowdown decay
            let exhaust_lift = ValveTrain::exhaust_lift(config, crank_deg);
            let lift_fraction = (exhaust_lift / config.max_exhaust_lift).clamp(0.01, 1.0);
            let tau_blowdown = 0.002 / lift_fraction;
            let decay_factor = (-dt / tau_blowdown).exp();
            cyl.pressure = config.ambient_pressure + (cyl.pressure - config.ambient_pressure) * decay_factor;
            cyl.gas_mass = cyl.pressure * new_volume
                / (thermo::R_AIR * cyl.temperature);
        }
        _ => {
            cyl.pressure =
                thermo::pressure_from_state(cyl.gas_mass, cyl.temperature, new_volume);
        }
    }

    let q_wall_coolant =
        heat::wall_to_coolant_heat_transfer(config, cyl.wall_temperature, dt);
    let wtc = wall_thermal_cap(config);
    cyl.wall_temperature += (q_gas_wall - q_wall_coolant) / wtc;
    cyl.wall_temperature = cyl.wall_temperature
        .max(config.coolant_temperature)
        .min(600.0);

    // Forces
    let f_gas = kinematics::gas_force(config, cyl.pressure);
    let f_inertia = kinematics::reciprocating_inertia_force(config, piston_accel);
    let f_friction =
        friction::piston_friction_force(config, cyl.pressure, piston_vel);
    let f_net = f_gas + f_inertia + f_friction;

    // Torque from this cylinder
    let tau_piston = kinematics::force_to_torque(config, f_net, piston_angle);

    // Volume tracking
    cyl.volume = new_volume;
    cyl.prev_volume = new_volume;

    // Valve lifts
    let intake_lift = ValveTrain::intake_lift(config, crank_deg);
    let exhaust_lift = ValveTrain::exhaust_lift(config, crank_deg);

    // Compute exhaust output fields — event-based: only non-zero at the
    // moment blowdown is first captured, not throughout the exhaust stroke.
    // This gives JS a clean one-shot signal per exhaust event.
    let blowdown_just_fired = stroke_phase == 3
        && pre_blowdown_pressure <= config.ambient_pressure * 1.1
        && cyl.blowdown_pressure > config.ambient_pressure * 1.1;
    let exhaust_pulse_intensity = if blowdown_just_fired {
        ((cyl.blowdown_pressure / config.ambient_pressure - 1.0) / 3.0).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let exhaust_gas_temp = if blowdown_just_fired {
        cyl.blowdown_temperature
    } else {
        config.ambient_temperature
    };

    CylinderStepResult {
        snapshot: CylinderSnapshot {
            crank_angle,
            piston_position: piston_pos,
            cylinder_pressure: cyl.pressure,
            gas_temperature: cyl.temperature,
            wall_temperature: cyl.wall_temperature,
            stroke_phase,
            intake_valve_lift: intake_lift,
            exhaust_valve_lift: exhaust_lift,
            burn_fraction: cyl.burn_fraction,
            cylinder_volume: new_volume,
            gas_force: f_gas,
            inertia_force: f_inertia,
            friction_force: f_friction,
            exhaust_pulse_intensity,
            exhaust_gas_temp,
        },
        torque_piston: tau_piston,
    }
}

// ── Single-cylinder Engine (original API, preserved) ───────────────

/// Main engine simulation.
#[wasm_bindgen]
pub struct Engine {
    config: EngineConfig,
    /// Crank angle in radians (continuous, wraps at 4π for 4-stroke).
    crank_angle: f64,
    /// Angular velocity in rad/s.
    omega: f64,
    /// Target angular velocity for dyno control in rad/s.
    target_omega: f64,
    /// Whether the dyno load controller is active.
    dyno_enabled: bool,
    /// PI controller integral error accumulator.
    integral_error: f64,
    /// Dyno mode: 0=speed PI, 1=load, 2=sweep, 3=constant power.
    dyno_mode: u8,
    /// Constant load torque for load mode (N·m).
    dyno_load_torque: f64,
    /// Target power for constant-power mode (W).
    dyno_target_power: f64,
    /// Throttle position [0, 1]. 1.0 = WOT.
    throttle_position: f64,
    /// Whether the starter motor is currently engaged.
    starter_engaged: bool,
    cylinder: CylinderState,
    // Cycle-average torque tracking
    prev_crank_angle: f64,
    cycle_torque_work: f64,
    cycle_time: f64,
    cycle_avg_torque: f64,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(config: EngineConfig) -> Self {
        let cylinder = CylinderState::new(&config);
        let initial_rpm = 800.0;
        let omega = initial_rpm * 2.0 * std::f64::consts::PI / 60.0;

        Self {
            config,
            crank_angle: 0.0,
            omega,
            target_omega: omega,
            dyno_enabled: true,
            integral_error: 0.0,
            dyno_mode: 0,
            dyno_load_torque: 10.0,
            dyno_target_power: 5000.0,
            throttle_position: 1.0,
            starter_engaged: false,
            cylinder,
            prev_crank_angle: 0.0,
            cycle_torque_work: 0.0,
            cycle_time: 0.0,
            cycle_avg_torque: 0.0,
        }
    }

    /// Advance simulation by dt seconds. Internally sub-steps so each
    /// physics tick covers at most ~1° of crank rotation.
    pub fn step(&mut self, dt: f64) -> SimulationState {
        let max_angle = 1.0_f64.to_radians();
        let n_steps = ((self.omega.abs() * dt) / max_angle)
            .ceil()
            .max(1.0)
            .min(2000.0) as usize;
        let sub_dt = dt / n_steps as f64;

        let mut state = SimulationState::default();
        let mut peak_exhaust_pulse = 0.0_f64;
        let mut peak_exhaust_gas_temp = 300.0_f64;
        for _ in 0..n_steps {
            state = self.step_inner(sub_dt);
            if state.exhaust_pulse_intensity > peak_exhaust_pulse {
                peak_exhaust_pulse = state.exhaust_pulse_intensity;
                peak_exhaust_gas_temp = state.exhaust_gas_temp;
            }
        }
        state.exhaust_pulse_intensity = peak_exhaust_pulse;
        state.exhaust_gas_temp = peak_exhaust_gas_temp;
        state
    }

    /// Get current RPM.
    pub fn rpm(&self) -> f64 {
        self.omega * 60.0 / (2.0 * std::f64::consts::PI)
    }

    /// Set RPM — updates target angular velocity only. PI controller adjusts throttle to reach it.
    pub fn set_rpm(&mut self, rpm: f64) {
        self.target_omega = rpm * 2.0 * std::f64::consts::PI / 60.0;
        self.integral_error = 0.0;
    }

    /// Enable or disable the dyno load controller.
    pub fn set_dyno_enabled(&mut self, enabled: bool) {
        self.dyno_enabled = enabled;
        if !enabled {
            self.integral_error = 0.0;
        }
    }

    /// Set the dyno proportional gain.
    pub fn set_dyno_gain(&mut self, gain: f64) {
        self.config.dyno_gain = gain;
    }

    /// Set the dyno integral gain.
    pub fn set_dyno_integral_gain(&mut self, gain: f64) {
        self.config.dyno_integral_gain = gain;
    }

    /// Set dyno mode (0=speed PI, 1=load, 2=sweep, 3=constant power). Resets integral error.
    pub fn set_dyno_mode(&mut self, mode: u8) {
        self.dyno_mode = mode;
        self.integral_error = 0.0;
    }

    /// Set dyno load torque for load mode (N·m).
    pub fn set_dyno_load(&mut self, torque: f64) {
        self.dyno_load_torque = torque;
    }

    /// Set target power for constant-power mode (W).
    pub fn set_dyno_target_power(&mut self, power: f64) {
        self.dyno_target_power = power;
    }

    /// Set target RPM without forcing omega. Resets integral error.
    pub fn set_target_rpm(&mut self, rpm: f64) {
        self.target_omega = rpm * 2.0 * std::f64::consts::PI / 60.0;
        self.integral_error = 0.0;
    }

    /// Set throttle position [0, 1].
    pub fn set_throttle(&mut self, position: f64) {
        self.throttle_position = position.clamp(0.0, 1.0);
    }

    /// Get current throttle position [0, 1].
    pub fn throttle(&self) -> f64 {
        self.throttle_position
    }

    /// Engage the starter motor. Gives an initial crank kick and keeps
    /// the starter engaged until RPM exceeds cranking speed (~300 RPM).
    pub fn start(&mut self) {
        self.starter_engaged = true;
        // Initial kick so the crank begins advancing
        if self.omega < 5.0 {
            self.omega = 50.0 * 2.0 * std::f64::consts::PI / 60.0; // ~50 RPM
        }
        self.integral_error = 0.0;
    }
}

// Non-wasm implementation details
impl Engine {
    /// Single physics sub-step — thin wrapper around step_cylinder.
    fn step_inner(&mut self, dt: f64) -> SimulationState {
        use std::f64::consts::PI;

        // Advance crank angle
        self.crank_angle += self.omega * dt;
        let four_pi = 4.0 * PI;
        self.crank_angle = self.crank_angle.rem_euclid(four_pi);

        // Compute manifold pressure from throttle
        let manifold_p = manifold_pressure(self.throttle_position, self.config.ambient_pressure);

        // Step the single cylinder
        let result = step_cylinder(
            &self.config,
            &mut self.cylinder,
            self.crank_angle,
            self.omega,
            dt,
            manifold_p,
        );

        // Bearing friction + load torque
        let tau_bearing = friction::bearing_friction_torque(self.omega);
        let tau_starter = starter_torque(self.omega, self.starter_engaged);
        // Auto-disengage starter once engine catches
        if self.starter_engaged && self.omega > 300.0 * 2.0 * PI / 60.0 {
            self.starter_engaged = false;
        }
        let tau_load = if self.dyno_enabled {
            match self.dyno_mode {
                0 | 2 => {
                    // Speed-control mode: PI adjusts throttle to hit target RPM
                    let error = self.target_omega - self.omega; // positive = need more power
                    self.integral_error += error * dt;
                    self.integral_error = self.integral_error.clamp(-50.0, 50.0);
                    let cmd = 0.3 + self.config.dyno_gain * 0.005 * error
                        + self.config.dyno_integral_gain * 0.005 * self.integral_error;
                    self.throttle_position = cmd.clamp(0.05, 1.0);
                    // Dyno absorber: idle load + speed-proportional damping
                    -self.config.idle_load_torque - 0.05 * self.omega
                }
                1 => -self.dyno_load_torque,
                3 => {
                    // Constant-power mode: τ = P / ω (hyperbolic load curve)
                    // Throttle is left under manual control.
                    let min_omega = 50.0 * 2.0 * PI / 60.0;
                    if self.omega > min_omega {
                        -self.dyno_target_power / self.omega
                    } else {
                        -self.dyno_target_power / min_omega
                    }
                }
                _ => 0.0,
            }
        } else if self.omega > 0.0 {
            -self.config.idle_load_torque
        } else {
            0.0
        };
        let tau_net = result.torque_piston + tau_bearing + tau_load + tau_starter;

        // Update angular velocity
        let max_omega = self.config.max_rpm * 2.0 * PI / 60.0;
        self.omega += (tau_net / self.config.crankshaft_inertia) * dt;
        self.omega = self.omega.clamp(0.0, max_omega);

        // NaN/Infinity guard
        if !self.cylinder.temperature.is_finite()
            || !self.cylinder.pressure.is_finite()
            || !self.omega.is_finite()
        {
            self.cylinder.temperature = self.config.ambient_temperature;
            self.cylinder.pressure = self.config.ambient_pressure;
            self.omega = 800.0 * 2.0 * PI / 60.0;
            self.cylinder.burn_fraction = 0.0;
            self.cylinder.prev_burn_fraction = 0.0;
            self.integral_error = 0.0;
        }

        // Cycle-average torque: accumulate torque*dt, commit on 720° wrap
        self.cycle_torque_work += tau_net * dt;
        self.cycle_time += dt;
        if self.crank_angle < self.prev_crank_angle {
            if self.cycle_time > 0.0 {
                self.cycle_avg_torque = self.cycle_torque_work / self.cycle_time;
            }
            self.cycle_torque_work = 0.0;
            self.cycle_time = 0.0;
        }
        self.prev_crank_angle = self.crank_angle;

        let rpm = self.omega * 60.0 / (2.0 * PI);
        let snap = &result.snapshot;

        // Audio params
        let audio = AudioParams::from_state(
            rpm,
            snap.cylinder_pressure,
            self.config.ambient_pressure,
            snap.stroke_phase,
            snap.burn_fraction,
            snap.exhaust_valve_lift,
        );

        SimulationState {
            crank_angle: self.crank_angle,
            piston_position: snap.piston_position,
            cylinder_pressure: snap.cylinder_pressure,
            gas_temperature: snap.gas_temperature,
            wall_temperature: snap.wall_temperature,
            torque: tau_net,
            rpm,
            stroke_phase: snap.stroke_phase,
            intake_valve_lift: snap.intake_valve_lift,
            exhaust_valve_lift: snap.exhaust_valve_lift,
            burn_fraction: snap.burn_fraction,
            cylinder_volume: snap.cylinder_volume,
            gas_force: snap.gas_force,
            inertia_force: snap.inertia_force,
            friction_force: snap.friction_force,
            combustion_intensity: audio.combustion_intensity,
            exhaust_intensity: audio.exhaust_intensity,
            mechanical_noise: audio.mechanical_noise,
            cycle_frequency: audio.cycle_frequency,
            cycle_avg_torque: self.cycle_avg_torque,
            manifold_pressure: manifold_p,
            exhaust_pulse_intensity: snap.exhaust_pulse_intensity,
            exhaust_gas_temp: snap.exhaust_gas_temp,
        }
    }
}

// ── Multi-cylinder Engine ──────────────────────────────────────────

/// Multi-cylinder engine simulation.
#[wasm_bindgen]
pub struct MultiCylinderEngine {
    config: EngineConfig,
    /// Per-cylinder state.
    cylinders: Vec<CylinderState>,
    /// Per-cylinder crank offset in radians.
    offsets: Vec<f64>,
    /// Base crank angle (cylinder 0).
    crank_angle: f64,
    omega: f64,
    target_omega: f64,
    dyno_enabled: bool,
    /// PI controller integral error accumulator.
    integral_error: f64,
    /// Dyno mode: 0=speed PI, 1=load, 2=sweep, 3=constant power.
    dyno_mode: u8,
    /// Constant load torque for load mode (N·m).
    dyno_load_torque: f64,
    /// Target power for constant-power mode (W).
    dyno_target_power: f64,
    /// Throttle position [0, 1]. 1.0 = WOT.
    throttle_position: f64,
    /// Whether the starter motor is currently engaged.
    starter_engaged: bool,
    // Cycle-average torque tracking
    prev_crank_angle: f64,
    cycle_torque_work: f64,
    cycle_time: f64,
    cycle_avg_torque: f64,
}

#[wasm_bindgen]
impl MultiCylinderEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(config: EngineConfig) -> Self {
        let n = config.cylinder_count.max(1) as usize;
        let offsets = config.firing_offsets();

        let mut cylinders = Vec::with_capacity(n);
        for _ in 0..n {
            cylinders.push(CylinderState::new(&config));
        }

        let initial_rpm = 800.0;
        let omega = initial_rpm * 2.0 * std::f64::consts::PI / 60.0;

        Self {
            config,
            cylinders,
            offsets,
            crank_angle: 0.0,
            omega,
            target_omega: omega,
            dyno_enabled: true,
            integral_error: 0.0,
            dyno_mode: 0,
            dyno_load_torque: 10.0,
            dyno_target_power: 5000.0,
            throttle_position: 1.0,
            starter_engaged: false,
            prev_crank_angle: 0.0,
            cycle_torque_work: 0.0,
            cycle_time: 0.0,
            cycle_avg_torque: 0.0,
        }
    }

    pub fn step(&mut self, dt: f64) -> MultiCylinderState {
        let max_angle = 1.0_f64.to_radians();
        let n_steps = ((self.omega.abs() * dt) / max_angle)
            .ceil()
            .max(1.0)
            .min(2000.0) as usize;
        let sub_dt = dt / n_steps as f64;

        let n = self.cylinders.len();
        let mut state = MultiCylinderState::default_for(n);
        let mut peak_exhaust_pulse = vec![0.0_f64; n];
        let mut peak_exhaust_gas_temp = vec![300.0_f64; n];
        for _ in 0..n_steps {
            state = self.step_inner(sub_dt);
            for (i, snap) in state.snapshots.iter().enumerate() {
                if snap.exhaust_pulse_intensity > peak_exhaust_pulse[i] {
                    peak_exhaust_pulse[i] = snap.exhaust_pulse_intensity;
                    peak_exhaust_gas_temp[i] = snap.exhaust_gas_temp;
                }
            }
        }
        for (i, snap) in state.snapshots.iter_mut().enumerate() {
            snap.exhaust_pulse_intensity = peak_exhaust_pulse[i];
            snap.exhaust_gas_temp = peak_exhaust_gas_temp[i];
        }
        state
    }

    pub fn rpm(&self) -> f64 {
        self.omega * 60.0 / (2.0 * std::f64::consts::PI)
    }

    /// Set RPM — updates target angular velocity only. PI controller adjusts throttle to reach it.
    pub fn set_rpm(&mut self, rpm: f64) {
        self.target_omega = rpm * 2.0 * std::f64::consts::PI / 60.0;
        self.integral_error = 0.0;
    }

    pub fn set_dyno_enabled(&mut self, enabled: bool) {
        self.dyno_enabled = enabled;
        if !enabled {
            self.integral_error = 0.0;
        }
    }

    pub fn set_dyno_gain(&mut self, gain: f64) {
        self.config.dyno_gain = gain;
    }

    pub fn set_dyno_integral_gain(&mut self, gain: f64) {
        self.config.dyno_integral_gain = gain;
    }

    pub fn set_dyno_mode(&mut self, mode: u8) {
        self.dyno_mode = mode;
        self.integral_error = 0.0;
    }

    pub fn set_dyno_load(&mut self, torque: f64) {
        self.dyno_load_torque = torque;
    }

    /// Set target power for constant-power mode (W).
    pub fn set_dyno_target_power(&mut self, power: f64) {
        self.dyno_target_power = power;
    }

    pub fn set_target_rpm(&mut self, rpm: f64) {
        self.target_omega = rpm * 2.0 * std::f64::consts::PI / 60.0;
        self.integral_error = 0.0;
    }

    /// Set throttle position [0, 1].
    pub fn set_throttle(&mut self, position: f64) {
        self.throttle_position = position.clamp(0.0, 1.0);
    }

    /// Get current throttle position [0, 1].
    pub fn throttle(&self) -> f64 {
        self.throttle_position
    }

    /// Engage the starter motor.
    pub fn start(&mut self) {
        self.starter_engaged = true;
        if self.omega < 5.0 {
            self.omega = 50.0 * 2.0 * std::f64::consts::PI / 60.0;
        }
        self.integral_error = 0.0;
    }
}

impl MultiCylinderEngine {
    fn step_inner(&mut self, dt: f64) -> MultiCylinderState {
        use std::f64::consts::PI;

        // Advance base crank angle
        self.crank_angle += self.omega * dt;
        let four_pi = 4.0 * PI;
        self.crank_angle = self.crank_angle.rem_euclid(four_pi);

        // Compute manifold pressure from throttle
        let manifold_p = manifold_pressure(self.throttle_position, self.config.ambient_pressure);

        let n = self.cylinders.len();
        let mut snapshots = Vec::with_capacity(n);
        let mut total_piston_torque = 0.0;

        for i in 0..n {
            let offset = self.offsets.get(i).copied().unwrap_or(0.0);
            let cyl_angle = (self.crank_angle + offset).rem_euclid(four_pi);

            let result = step_cylinder(
                &self.config,
                &mut self.cylinders[i],
                cyl_angle,
                self.omega,
                dt,
                manifold_p,
            );
            total_piston_torque += result.torque_piston;
            snapshots.push(result.snapshot);
        }

        // Shared torques
        let tau_bearing = friction::bearing_friction_torque(self.omega);
        let tau_starter = starter_torque(self.omega, self.starter_engaged);
        // Auto-disengage starter once engine catches
        if self.starter_engaged && self.omega > 300.0 * 2.0 * PI / 60.0 {
            self.starter_engaged = false;
        }
        let tau_load = if self.dyno_enabled {
            match self.dyno_mode {
                0 | 2 => {
                    // Speed-control mode: PI adjusts throttle to hit target RPM
                    let error = self.target_omega - self.omega;
                    self.integral_error += error * dt;
                    self.integral_error = self.integral_error.clamp(-50.0, 50.0);
                    let cmd = 0.3 + self.config.dyno_gain * 0.005 * error
                        + self.config.dyno_integral_gain * 0.005 * self.integral_error;
                    self.throttle_position = cmd.clamp(0.05, 1.0);
                    // Dyno absorber: idle load + speed-proportional damping
                    -self.config.idle_load_torque - 0.05 * self.omega
                }
                1 => -self.dyno_load_torque,
                3 => {
                    // Constant-power mode: τ = P / ω (hyperbolic load curve)
                    let min_omega = 50.0 * 2.0 * PI / 60.0;
                    if self.omega > min_omega {
                        -self.dyno_target_power / self.omega
                    } else {
                        -self.dyno_target_power / min_omega
                    }
                }
                _ => 0.0,
            }
        } else if self.omega > 0.0 {
            -self.config.idle_load_torque
        } else {
            0.0
        };
        let tau_net = total_piston_torque + tau_bearing + tau_load + tau_starter;

        // Update angular velocity (scale inertia by cylinder count for realism)
        let inertia = self.config.crankshaft_inertia * n as f64;
        let max_omega = self.config.max_rpm * 2.0 * PI / 60.0;
        self.omega += (tau_net / inertia) * dt;
        self.omega = self.omega.clamp(0.0, max_omega);

        // NaN guard
        if !self.omega.is_finite() {
            self.omega = 800.0 * 2.0 * PI / 60.0;
            self.integral_error = 0.0;
            for cyl in &mut self.cylinders {
                cyl.temperature = self.config.ambient_temperature;
                cyl.pressure = self.config.ambient_pressure;
                cyl.burn_fraction = 0.0;
                cyl.prev_burn_fraction = 0.0;
            }
        }

        // Cycle-average torque tracking
        self.cycle_torque_work += tau_net * dt;
        self.cycle_time += dt;
        if self.crank_angle < self.prev_crank_angle {
            if self.cycle_time > 0.0 {
                self.cycle_avg_torque = self.cycle_torque_work / self.cycle_time;
            }
            self.cycle_torque_work = 0.0;
            self.cycle_time = 0.0;
        }
        self.prev_crank_angle = self.crank_angle;

        let rpm = self.omega * 60.0 / (2.0 * PI);

        // Aggregate audio from all cylinders (sum intensities, cap at 1.0)
        let mut comb_sum = 0.0_f64;
        let mut exh_sum = 0.0_f64;
        for snap in &snapshots {
            let audio = AudioParams::from_state(
                rpm,
                snap.cylinder_pressure,
                self.config.ambient_pressure,
                snap.stroke_phase,
                snap.burn_fraction,
                snap.exhaust_valve_lift,
            );
            comb_sum += audio.combustion_intensity;
            exh_sum += audio.exhaust_intensity;
        }

        let mech = (rpm / 6000.0).clamp(0.0, 1.0) * 0.3;
        let cycle_freq = rpm / 120.0 * n as f64;

        MultiCylinderState {
            rpm,
            total_torque: tau_net,
            cylinder_count: n as u8,
            combustion_intensity: comb_sum.min(1.0),
            exhaust_intensity: exh_sum.min(1.0),
            mechanical_noise: mech,
            cycle_frequency: cycle_freq,
            cycle_avg_torque: self.cycle_avg_torque,
            manifold_pressure: manifold_p,
            snapshots,
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn default_engine() -> Engine {
        Engine::new(EngineConfig::default())
    }

    /// Small timestep in seconds (~0.1° at 800 RPM).
    const DT: f64 = 0.000_02;

    /// Advance the engine to a target crank angle (degrees, 0-720).
    fn advance_to_deg(engine: &mut Engine, target_deg: f64) -> SimulationState {
        let mut state = SimulationState::default();
        let target_rad = target_deg.to_radians();
        for _ in 0..500_000 {
            state = engine.step(DT);
            if state.crank_angle >= target_rad {
                return state;
            }
        }
        state
    }

    /// Run one full 720° cycle and return all states sampled.
    fn run_full_cycle(engine: &mut Engine) -> Vec<SimulationState> {
        let mut states = Vec::new();
        let start = engine.crank_angle;
        let four_pi = 4.0 * std::f64::consts::PI;
        for _ in 0..2_000_000 {
            let state = engine.step(DT);
            states.push(state);
            let elapsed = engine.crank_angle - start
                + if engine.crank_angle < start { four_pi } else { 0.0 };
            if elapsed >= four_pi * 0.99 {
                break;
            }
        }
        states
    }

    #[test]
    fn compression_raises_pressure() {
        let mut engine = default_engine();
        let state = advance_to_deg(&mut engine, 300.0);
        assert_eq!(state.stroke_phase, 1, "Should be in compression");
        assert!(
            state.cylinder_pressure > 101_325.0 * 1.5,
            "Compression must raise pressure above ambient, got {} Pa",
            state.cylinder_pressure,
        );
    }

    #[test]
    fn compression_raises_temperature() {
        let mut engine = default_engine();
        let state = advance_to_deg(&mut engine, 300.0);
        assert!(
            state.gas_temperature > 350.0,
            "Compression must raise temperature above ambient, got {} K",
            state.gas_temperature,
        );
    }

    #[test]
    fn power_stroke_produces_positive_torque() {
        let mut engine = default_engine();
        let state = advance_to_deg(&mut engine, 400.0);
        assert_eq!(state.stroke_phase, 2, "Should be in power stroke");
        assert!(
            state.cylinder_pressure > 101_325.0 * 2.0,
            "Power stroke should have elevated pressure from combustion, got {} Pa",
            state.cylinder_pressure,
        );
    }

    #[test]
    fn combustion_starts_during_compression() {
        let mut engine = default_engine();
        let state = advance_to_deg(&mut engine, 355.0);
        assert_eq!(state.stroke_phase, 1, "Should still be in compression");
        assert!(
            state.burn_fraction > 0.0,
            "Combustion should have started before TDC, burn_fraction = {}",
            state.burn_fraction,
        );
    }

    #[test]
    fn rpm_changes_dynamically() {
        let mut engine = default_engine();
        let initial_rpm = engine.rpm();
        let states = run_full_cycle(&mut engine);
        let final_rpm = engine.rpm();

        let rpm_values: Vec<f64> = states.iter().map(|s| s.rpm).collect();
        let min_rpm = rpm_values.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_rpm = rpm_values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let rpm_variation = max_rpm - min_rpm;

        assert!(
            rpm_variation > 1.0,
            "RPM should fluctuate during a cycle, variation was only {} RPM \
             (range {:.1}-{:.1}, initial {:.1}, final {:.1})",
            rpm_variation, min_rpm, max_rpm, initial_rpm, final_rpm,
        );
    }

    #[test]
    fn temperature_stays_bounded() {
        let mut engine = default_engine();
        let states = run_full_cycle(&mut engine);

        for state in &states {
            assert!(
                state.gas_temperature >= 250.0,
                "Gas temperature below 250 K: {} K at {:.1}°",
                state.gas_temperature,
                state.crank_angle.to_degrees(),
            );
            assert!(
                state.gas_temperature < 4000.0,
                "Gas temperature exceeds 4000 K: {} K at {:.1}°",
                state.gas_temperature,
                state.crank_angle.to_degrees(),
            );
        }
    }

    #[test]
    fn wall_temperature_stays_bounded() {
        let mut engine = default_engine();
        let states = run_full_cycle(&mut engine);

        for state in &states {
            assert!(
                state.wall_temperature >= 300.0,
                "Wall temp below 300 K: {} K",
                state.wall_temperature,
            );
            assert!(
                state.wall_temperature <= 600.0,
                "Wall temp exceeds 600 K: {} K",
                state.wall_temperature,
            );
        }
    }

    #[test]
    fn exhaust_returns_near_ambient_pressure() {
        let mut engine = default_engine();
        let state = advance_to_deg(&mut engine, 600.0);
        assert_eq!(state.stroke_phase, 3, "Should be in exhaust stroke");
        let diff = (state.cylinder_pressure - 101_325.0).abs();
        assert!(
            diff < 50_000.0,
            "Exhaust pressure should decay toward ambient, got {} Pa (diff {})",
            state.cylinder_pressure, diff,
        );
    }

    #[test]
    fn engine_does_not_stall_over_multiple_cycles() {
        let mut engine = default_engine();
        for _ in 0..3 {
            run_full_cycle(&mut engine);
        }
        assert!(
            engine.rpm() > 100.0,
            "Engine should not stall, RPM = {}",
            engine.rpm(),
        );
    }

    #[test]
    fn long_running_stability() {
        let mut engine = default_engine();
        let cycle_dt = 0.010;
        let steps_per_cycle = 100;
        let num_cycles = 60;

        for cycle in 0..num_cycles {
            for _ in 0..steps_per_cycle {
                let state = engine.step(cycle_dt);

                assert!(
                    state.rpm.is_finite(),
                    "RPM became non-finite at cycle {}",
                    cycle,
                );
                assert!(
                    state.gas_temperature.is_finite(),
                    "Gas temperature became non-finite at cycle {}",
                    cycle,
                );
                assert!(
                    state.cylinder_pressure.is_finite(),
                    "Cylinder pressure became non-finite at cycle {}",
                    cycle,
                );
                assert!(
                    state.rpm <= 8500.0,
                    "RPM exceeded safe limit: {} at cycle {}",
                    state.rpm,
                    cycle,
                );
            }
        }

        let final_rpm = engine.rpm();
        assert!(
            final_rpm > 100.0,
            "Engine stalled after extended running, RPM = {}",
            final_rpm,
        );
        assert!(
            final_rpm <= 8000.0,
            "RPM exceeded rev limiter after extended running: {}",
            final_rpm,
        );
    }

    #[test]
    fn large_dt_matches_small_dt() {
        let mut engine_large = default_engine();
        let mut engine_small = default_engine();

        let large_dt = 0.010;
        let state_large = engine_large.step(large_dt);

        let mut state_small = SimulationState::default();
        for _ in 0..500 {
            state_small = engine_small.step(DT);
        }

        let angle_diff =
            (state_large.crank_angle - state_small.crank_angle).abs();
        assert!(
            angle_diff < 0.05,
            "Crank angles diverged: large={:.4} small={:.4} diff={:.4}",
            state_large.crank_angle, state_small.crank_angle, angle_diff,
        );
    }

    // ── Multi-cylinder tests ───────────────────────────────────────

    #[test]
    fn multi_cylinder_i4_runs_stably() {
        let mut config = EngineConfig::default();
        config.cylinder_count = 4;
        config.crank_offsets_deg = vec![0.0, 180.0, 540.0, 360.0];
        let mut engine = MultiCylinderEngine::new(config);

        for _ in 0..100 {
            let state = engine.step(0.010);
            assert!(state.rpm.is_finite(), "RPM non-finite in I4");
            assert_eq!(state.cylinder_count, 4);
        }
        assert!(engine.rpm() > 100.0, "I4 stalled, RPM = {}", engine.rpm());
    }

    #[test]
    fn blowdown_captures_elevated_pressure() {
        let mut engine = default_engine();
        // Advance past power stroke into early exhaust
        let state = advance_to_deg(&mut engine, 545.0);
        assert_eq!(state.stroke_phase, 3, "Should be in exhaust stroke");
        // Pressure should still be above ambient due to blowdown decay
        assert!(
            state.cylinder_pressure > 101_325.0,
            "Early exhaust pressure should be above ambient (blowdown), got {} Pa",
            state.cylinder_pressure,
        );
    }

    #[test]
    fn exhaust_pulse_intensity_nonzero() {
        let mut engine = default_engine();
        // Run through a full cycle to get to exhaust stroke
        let states = run_full_cycle(&mut engine);
        let has_pulse = states.iter().any(|s| s.exhaust_pulse_intensity > 0.0);
        assert!(
            has_pulse,
            "exhaust_pulse_intensity should be > 0 during exhaust stroke in at least one sample",
        );
    }

    #[test]
    fn pi_controller_converges() {
        let mut config = EngineConfig::default();
        config.dyno_gain = 2.0;
        config.dyno_integral_gain = 1.0;
        let mut engine = Engine::new(config);
        engine.set_dyno_enabled(true);
        engine.set_dyno_mode(0);
        engine.set_target_rpm(3000.0);

        let dt = 0.010;
        for _ in 0..1500 {
            engine.step(dt);
        }

        let rpm = engine.rpm();
        assert!(
            (rpm - 3000.0).abs() < 200.0,
            "PI controller should converge to 3000 RPM within ±200, got {:.1}",
            rpm,
        );
    }

    #[test]
    fn load_mode_reaches_equilibrium() {
        let mut config = EngineConfig::default();
        config.dyno_load_torque = 5.0;
        let mut engine = Engine::new(config);
        engine.set_dyno_enabled(true);
        engine.set_dyno_mode(1);
        engine.set_dyno_load(5.0);

        let dt = 0.010;
        for _ in 0..500 {
            engine.step(dt);
        }

        let rpm = engine.rpm();
        assert!(
            rpm > 100.0,
            "Load mode engine should reach equilibrium above 100 RPM, got {:.1}",
            rpm,
        );
    }

    #[test]
    fn multi_cylinder_returns_correct_count() {
        let mut config = EngineConfig::default();
        config.cylinder_count = 2;
        config.crank_offsets_deg = vec![0.0, 360.0];
        let mut engine = MultiCylinderEngine::new(config);
        let state = engine.step(0.010);
        assert_eq!(state.cylinder_count, 2);

        let snapshots: Vec<CylinderSnapshot> =
            serde_json::from_str(&state.cylinders_json()).unwrap();
        assert_eq!(snapshots.len(), 2);
    }

    // ── Throttle tests ────────────────────────────────────────────

    #[test]
    fn throttle_reduces_power() {
        let dt = 0.010;

        let mut wot_engine = Engine::new(EngineConfig::default());
        wot_engine.set_dyno_enabled(false);
        wot_engine.set_throttle(1.0);
        let mut wot_torque_sum = 0.0;
        for _ in 0..500 {
            let state = wot_engine.step(dt);
            wot_torque_sum += state.torque;
        }

        let mut part_engine = Engine::new(EngineConfig::default());
        part_engine.set_dyno_enabled(false);
        part_engine.set_throttle(0.2);
        let mut part_torque_sum = 0.0;
        for _ in 0..500 {
            let state = part_engine.step(dt);
            part_torque_sum += state.torque;
        }

        assert!(
            wot_torque_sum > part_torque_sum,
            "WOT should produce more total torque than 20% throttle: WOT={:.1}, part={:.1}",
            wot_torque_sum, part_torque_sum,
        );
    }

    #[test]
    fn closed_throttle_low_rpm() {
        let mut config = EngineConfig::default();
        config.idle_load_torque = 30.0; // heavy accessory load
        let mut engine = Engine::new(config);
        engine.set_dyno_enabled(false);
        engine.set_throttle(0.0);

        let initial_rpm = engine.rpm();
        let dt = 0.010;
        for _ in 0..500 {
            engine.step(dt);
        }

        let final_rpm = engine.rpm();
        assert!(
            final_rpm < initial_rpm,
            "Near-closed throttle should cause RPM to drop: initial={:.1}, final={:.1}",
            initial_rpm, final_rpm,
        );
    }

    #[test]
    fn pi_throttle_converges() {
        let mut config = EngineConfig::default();
        config.dyno_gain = 2.0;
        config.dyno_integral_gain = 1.0;
        let mut engine = Engine::new(config);
        engine.set_dyno_enabled(true);
        engine.set_dyno_mode(0);
        engine.set_target_rpm(3000.0);

        let dt = 0.010;
        for _ in 0..1500 {
            engine.step(dt);
        }

        let rpm = engine.rpm();
        assert!(
            (rpm - 3000.0).abs() < 200.0,
            "PI throttle controller should converge to 3000 RPM within ±200, got {:.1}",
            rpm,
        );
    }
}
