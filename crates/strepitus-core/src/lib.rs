// lib.rs — WASM bindings: unified Engine for single + multi-cylinder

pub mod components;
pub mod config;
pub mod engine;
pub mod types;

use crate::config::EngineConfig;
use crate::engine::{EngineRuntime, step_engine};
use crate::types::{MultiCylinderState, SimulationState};
use wasm_bindgen::prelude::*;

/// Called when the WASM module loads.
#[wasm_bindgen(start)]
pub fn init() {
    web_sys::console::log_1(&"[strepitus-core] WASM module initialized (v2 component architecture)".into());
}

/// Version string for the physics engine.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── Unified Engine (replaces both Engine and MultiCylinderEngine) ────────

/// Engine simulation — single or multi-cylinder, driven by EngineConfig.
/// JS API:
///   const eng = new Engine(config)
///   eng.step()          // single-cylinder → SimulationState
///   eng.step_multi()    // any cylinder count → MultiCylinderState
///   eng.set_throttle(t) // 0.0–1.0
///   eng.set_rpm_target(rpm) // for dyno mode 0
#[wasm_bindgen]
pub struct Engine {
    params: crate::config::EngineParams,
    runtime: EngineRuntime,
    /// Degrees per JS tick (typically 6–12°, corresponding to ~1ms at 3000 RPM).
    deg_per_tick: f64,
    /// Stored config JSON for rebuild.
    config_json: String,
    /// Current target RPM (for dyno mode 0).
    target_rpm: f64,
}

#[wasm_bindgen]
impl Engine {
    /// Create a new engine from an EngineConfig.
    /// Takes ownership of config — caller should snapshot toJSON() first.
    #[wasm_bindgen(constructor)]
    pub fn new(config: EngineConfig) -> Engine {
        let config_json = config.to_json();
        let params = config.into_params();
        let runtime = EngineRuntime::new(&params);
        Engine {
            params,
            runtime,
            deg_per_tick: 6.0,
            config_json,
            target_rpm: 1000.0,
        }
    }

    /// Set throttle position [0, 1].
    pub fn set_throttle(&mut self, throttle: f64) {
        self.runtime.throttle = throttle.clamp(0.0, 1.0);
    }

    /// Get current throttle position.
    pub fn throttle(&self) -> f64 { self.runtime.throttle }

    /// Set target RPM (for dyno speed-PI mode).
    pub fn set_rpm_target(&mut self, rpm: f64) {
        self.target_rpm = rpm;
    }

    /// Rebuild engine from a new config JSON string.
    pub fn rebuild(&mut self, json: &str) -> Result<(), JsValue> {
        let config: EngineConfig = serde_json::from_str(json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.config_json = config.to_json();
        self.params = config.into_params();
        self.runtime = EngineRuntime::new(&self.params);
        Ok(())
    }

    /// Step the engine for single-cylinder use (N=1).
    /// Runs DEG_PER_TICK degrees worth of sub-steps at 1°/sub-step.
    /// Returns SimulationState (same fields as old API).
    pub fn step(&mut self) -> SimulationState {
        let snap = self.run_substeps();
        if snap.snapshots.is_empty() {
            return SimulationState::default();
        }
        let s = &snap.snapshots[0];
        SimulationState {
            crank_angle: s.crank_angle,
            piston_position: s.piston_position,
            cylinder_pressure: s.cylinder_pressure,
            gas_temperature: s.gas_temperature,
            wall_temperature: s.wall_temperature,
            torque: snap.total_torque,
            rpm: snap.rpm,
            stroke_phase: s.stroke_phase,
            intake_valve_lift: s.intake_valve_lift,
            exhaust_valve_lift: s.exhaust_valve_lift,
            burn_fraction: s.burn_fraction,
            cylinder_volume: s.cylinder_volume,
            gas_force: s.gas_force,
            inertia_force: s.inertia_force,
            friction_force: s.friction_force,
            combustion_intensity: snap.combustion_intensity,
            exhaust_intensity: snap.exhaust_intensity,
            mechanical_noise: snap.mechanical_noise,
            cycle_frequency: snap.cycle_frequency,
            cycle_avg_torque: snap.cycle_avg_torque,
            manifold_pressure: snap.manifold_pressure,
            exhaust_pulse_intensity: s.exhaust_pulse_intensity,
            exhaust_gas_temp: s.exhaust_gas_temp,
        }
    }

    /// Step the engine for multi-cylinder use (any N).
    /// Returns MultiCylinderState with cylindersFlat() layout identical to old API.
    pub fn step_multi(&mut self) -> MultiCylinderState {
        let snap = self.run_substeps();
        MultiCylinderState::from_engine_snapshot(&snap)
    }

    /// Run all sub-steps for one tick and return the final EngineSnapshot.
    fn run_substeps(&mut self) -> crate::types::EngineSnapshot {
        use crate::engine::DEG_PER_SUBSTEP;

        let substeps = (self.deg_per_tick / DEG_PER_SUBSTEP).round() as usize;
        let substeps = substeps.max(1);

        // Compute dt per sub-step from current omega
        let omega = self.runtime.omega.max(10.0); // prevent divide-by-zero
        let deg_per_sec = omega.to_degrees();
        let dt_per_substep = (DEG_PER_SUBSTEP / deg_per_sec).clamp(1e-6, 0.01);

        let mut last_snap = crate::types::EngineSnapshot {
            rpm: 0.0,
            total_torque: 0.0,
            cycle_avg_torque: 0.0,
            combustion_intensity: 0.0,
            exhaust_intensity: 0.0,
            mechanical_noise: 0.0,
            cycle_frequency: 0.0,
            manifold_pressure: 101_325.0,
            snapshots: Vec::new(),
            coolant_temperature: 363.0,
            oil_pressure: 0.0,
            oil_viscosity: 0.010,
        };

        let d_angle = DEG_PER_SUBSTEP.to_radians();
        for _ in 0..substeps {
            last_snap = step_engine(&self.params, &mut self.runtime, d_angle, dt_per_substep);
        }

        last_snap
    }

    // ── Tier 2: Per-component snapshot getters ───────────────────────────

    /// Combustion snapshot for cylinder `cyl_idx` as JSON.
    pub fn combustion_snapshot(&self, cyl_idx: usize) -> String {
        if cyl_idx >= self.runtime.cylinders.len() {
            return "{}".into();
        }
        let c = &self.runtime.cylinders[cyl_idx];
        let s = &c.snapshot;
        serde_json::json!({
            "pressure": s.cylinder_pressure,
            "temperature": s.gas_temperature,
            "burn_fraction": s.burn_fraction,
            "gamma": crate::components::combustion::formulas::gamma_air(s.gas_temperature),
            "q_released": 0.0, // not stored in snapshot; would need explicit field
        })
        .to_string()
    }

    /// Heat transfer snapshot for cylinder `cyl_idx` as JSON.
    pub fn heat_snapshot(&self, cyl_idx: usize) -> String {
        if cyl_idx >= self.runtime.cylinders.len() {
            return "{}".into();
        }
        let c = &self.runtime.cylinders[cyl_idx];
        serde_json::json!({
            "wall_temperature": c.wall.wall_temperature,
            "coolant_temperature": self.runtime.cooling.coolant_temperature,
        })
        .to_string()
    }

    /// Friction/lubrication snapshot for cylinder `cyl_idx` as JSON.
    pub fn friction_snapshot(&self, cyl_idx: usize) -> String {
        if cyl_idx >= self.runtime.cylinders.len() {
            return "{}".into();
        }
        let lube = crate::components::lubrication::formulas::walther_viscosity(
            self.params.lubrication.walther_eta_ref,
            self.params.lubrication.walther_t_ref,
            self.params.lubrication.walther_b,
            self.runtime.cooling.coolant_temperature + 5.0,
        );
        let p_oil = crate::components::lubrication::formulas::oil_pressure(
            self.runtime.omega * 60.0 / (2.0 * std::f64::consts::PI),
            self.params.lubrication.pump_k,
            self.params.lubrication.relief_pressure,
        );
        serde_json::json!({
            "oil_viscosity_mPas": lube * 1000.0,
            "oil_pressure_bar": p_oil / 1e5,
            "peak_pressure_bar": self.runtime.cylinders[cyl_idx].peak_pressure / 1e5,
        })
        .to_string()
    }

    /// Intake/exhaust snapshot for cylinder `cyl_idx` as JSON.
    pub fn intake_exhaust_snapshot(&self, cyl_idx: usize) -> String {
        if cyl_idx >= self.runtime.cylinders.len() {
            return "{}".into();
        }
        let s = &self.runtime.cylinders[cyl_idx].snapshot;
        serde_json::json!({
            "manifold_pressure_bar": self.runtime.intake.manifold_pressure / 1e5,
            "egt_k": s.exhaust_gas_temp,
            "egt_c": s.exhaust_gas_temp - 273.15,
            "exhaust_pulse": s.exhaust_pulse_intensity,
        })
        .to_string()
    }

    /// ECU snapshot as JSON.
    pub fn ecu_snapshot(&self) -> String {
        serde_json::json!({
            "stft": self.runtime.ecu.stft,
            "stft_integral": self.runtime.ecu.stft_integral,
            "throttle": self.runtime.throttle,
        })
        .to_string()
    }

    /// Current RPM.
    pub fn rpm(&self) -> f64 {
        self.runtime.omega * 60.0 / (2.0 * std::f64::consts::PI)
    }

    /// Current crank angle in radians.
    pub fn crank_angle(&self) -> f64 { self.runtime.crank_angle_rad }

    // ── Dyno / control setters ───────────────────────────────────────────

    /// Set dyno mode: 0=speed PI, 1=constant load, 2=sweep.
    pub fn set_dyno_mode(&mut self, mode: u8) {
        self.params.dyno.dyno_mode = mode;
    }

    /// Set constant load torque in N·m (for dyno mode 1).
    pub fn set_dyno_load(&mut self, load: f64) {
        self.params.dyno.dyno_load_torque = load;
    }

    /// Set dyno proportional gain.
    pub fn set_dyno_gain(&mut self, gain: f64) {
        self.params.dyno.dyno_gain = gain;
    }

    /// Set dyno integral gain.
    pub fn set_dyno_integral_gain(&mut self, gain: f64) {
        self.params.dyno.dyno_integral_gain = gain;
    }

    /// Set max RPM (rev limiter).
    pub fn set_max_rpm(&mut self, rpm: f64) {
        self.params.dyno.max_rpm = rpm;
    }

    /// No-op: dyno is always enabled — the mode controls its behavior.
    /// Retained for API compatibility.
    pub fn set_dyno_enabled(&mut self, _enabled: bool) {}

    /// No-op: target power not directly supported.
    pub fn set_dyno_target_power(&mut self, _watts: f64) {}
}

