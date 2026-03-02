// config.rs — Flat WASM-facing EngineConfig + hierarchical EngineParams
//
// EngineConfig is the existing JSON-compatible flat struct exposed to JS.
// into_params() converts it to the hierarchical EngineParams used internally.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::components::{
    combustion::interface::CombustionConfig,
    cooling::interface::CoolingConfig,
    ecu::interface::EcuConfig,
    exhaust::interface::ExhaustConfig,
    friction::interface::FrictionConfig,
    heat_transfer::interface::HeatTransferConfig,
    intake::interface::IntakeConfig,
    kinematics::interface::KinematicsConfig,
    lubrication::interface::LubricationConfig,
    valve_train::interface::ValveTrainConfig,
};

// ── Flat WASM-facing config (JSON-compatible with all existing presets) ─────

/// Complete engine configuration — all values tweakable from the UI.
/// Field names are identical to the previous EngineConfig so all existing
/// JSON presets load without changes.
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    // ── Geometry ──
    pub bore: f64,
    pub stroke: f64,
    pub con_rod_length: f64,
    pub compression_ratio: f64,
    // ── Masses ──
    pub piston_mass: f64,
    pub con_rod_mass: f64,
    pub crankshaft_inertia: f64,
    // ── Valve timing (degrees) ──
    pub ivo: f64,
    pub ivc: f64,
    pub evo: f64,
    pub evc: f64,
    pub max_intake_lift: f64,
    pub max_exhaust_lift: f64,
    // ── Fuel ──
    pub afr: f64,
    pub fuel_lhv: f64,
    pub combustion_efficiency: f64,
    // ── Wiebe ──
    pub wiebe_a: f64,
    pub wiebe_m: f64,
    pub combustion_duration: f64,
    pub spark_advance: f64,
    // ── Environment ──
    pub ambient_pressure: f64,
    pub ambient_temperature: f64,
    // ── Legacy friction (mapped to Chen-Flynn) ──
    pub ring_friction_coefficient: f64,
    pub viscous_friction: f64,
    // ── Thermal ──
    pub wall_conductivity: f64,
    pub coolant_temperature: f64,
    // ── Control ──
    pub max_rpm: f64,
    pub idle_load_torque: f64,
    pub dyno_gain: f64,
    #[serde(default = "default_dyno_integral_gain")]
    pub dyno_integral_gain: f64,
    #[serde(default = "default_dyno_load_torque")]
    pub dyno_load_torque: f64,
    #[serde(default = "default_throttle_diameter")]
    pub throttle_diameter: f64,
    #[serde(default)]
    pub dyno_mode: u8,
    // ── Multi-cylinder ──
    #[wasm_bindgen(skip)]
    #[serde(default = "default_cylinder_count")]
    pub cylinder_count: u8,
    #[wasm_bindgen(skip)]
    #[serde(default)]
    pub crank_offsets_deg: Vec<f64>,
}

fn default_cylinder_count() -> u8 { 1 }
fn default_throttle_diameter() -> f64 { 0.044 }
fn default_dyno_integral_gain() -> f64 { 0.5 }
fn default_dyno_load_torque() -> f64 { 10.0 }

#[wasm_bindgen]
impl EngineConfig {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self { Self::default() }

    #[wasm_bindgen(js_name = fromJSON)]
    pub fn from_json(json: &str) -> Result<EngineConfig, JsValue> {
        serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = toJSON)]
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_default()
    }

    #[wasm_bindgen(getter, js_name = cylinder_count)]
    pub fn get_cylinder_count(&self) -> u8 { self.cylinder_count }

    #[wasm_bindgen(setter, js_name = cylinder_count)]
    pub fn set_cylinder_count(&mut self, count: u8) { self.cylinder_count = count; }
}

impl EngineConfig {
    /// Crank offsets in radians for all cylinders.
    /// Falls back to built-in firing order tables when crank_offsets_deg is empty.
    pub fn firing_offsets(&self) -> Vec<f64> {
        let n = self.cylinder_count.max(1) as usize;
        if n == 1 { return vec![0.0]; }

        let degs = if !self.crank_offsets_deg.is_empty() {
            self.crank_offsets_deg.clone()
        } else {
            match n {
                2 => vec![0.0, 360.0],
                3 => vec![0.0, 240.0, 480.0],
                4 => vec![0.0, 180.0, 540.0, 360.0], // 1-3-4-2
                6 => vec![0.0, 120.0, 240.0, 360.0, 480.0, 600.0],
                8 => vec![0.0, 90.0, 270.0, 180.0, 630.0, 540.0, 450.0, 360.0],
                _ => (0..n).map(|i| i as f64 * 720.0 / n as f64).collect(),
            }
        };

        degs.iter().take(n).map(|d| d.to_radians()).collect()
    }

    /// Convert flat config to hierarchical EngineParams.
    pub fn into_params(&self) -> EngineParams {
        let r = self.stroke / 2.0;
        let lambda = r / self.con_rod_length;

        EngineParams {
            kinematics: KinematicsConfig {
                bore: self.bore,
                stroke: self.stroke,
                con_rod_length: self.con_rod_length,
                compression_ratio: self.compression_ratio,
                piston_mass: self.piston_mass,
                con_rod_mass: self.con_rod_mass,
                crank_radius: r,
                rod_ratio: lambda,
            },
            combustion: CombustionConfig {
                bore: self.bore,
                stroke: self.stroke,
                compression_ratio: self.compression_ratio,
                afr: self.afr,
                fuel_lhv: self.fuel_lhv,
                combustion_efficiency: self.combustion_efficiency,
                wiebe_a: self.wiebe_a,
                wiebe_m: self.wiebe_m,
                combustion_duration_deg: self.combustion_duration,
                spark_advance_deg: self.spark_advance,
                ambient_pressure: self.ambient_pressure,
                ambient_temperature: self.ambient_temperature,
            },
            valve_train: ValveTrainConfig {
                ivo_deg: self.ivo,
                ivc_deg: self.ivc,
                evo_deg: self.evo,
                evc_deg: self.evc,
                max_intake_lift: self.max_intake_lift,
                max_exhaust_lift: self.max_exhaust_lift,
            },
            intake: IntakeConfig {
                throttle_diameter: self.throttle_diameter,
                manifold_volume: 2.0e-3, // 2L manifold — not yet exposed in UI
                ambient_pressure: self.ambient_pressure,
                ambient_temperature: self.ambient_temperature,
            },
            exhaust: ExhaustConfig {
                ambient_pressure: self.ambient_pressure,
                ambient_temperature: self.ambient_temperature,
            },
            heat_transfer: HeatTransferConfig {
                bore: self.bore,
                stroke: self.stroke,
                woschni_c1: 2.28,
                woschni_c2: 3.24e-3,
                wall_thermal_mass: {
                    // Cast iron wall: 5mm thick
                    let wall_vol = std::f64::consts::PI * self.bore * self.stroke * 0.005;
                    7200.0 * wall_vol * 500.0 // ρ × V × cp
                },
                coolant_temperature: self.coolant_temperature,
            },
            friction: FrictionConfig {
                // Chen-Flynn coefficients for typical petrol engine
                cf_a: 0.61e5,   // Pa (0.61 bar)
                cf_b: 0.0056,
                cf_c: 1.57e4,   // Pa·s/m (0.157 bar·s/m)
                cf_d: 28.0,     // Pa·s²/m² (0.0028 bar·s²/m²)
                bore: self.bore,
                stroke: self.stroke,
                // Petroff main bearing geometry (typical 4-cyl)
                bearing_radius: 0.028,
                bearing_length: 0.025,
                bearing_clearance: 40e-6,
                bearing_count: 5,
            },
            lubrication: LubricationConfig {
                // SAE 5W-30 Walther coefficients
                walther_eta_ref: 11.5e-3, // Pa·s at T_ref
                walther_t_ref: 373.0,     // 100°C
                walther_b: 3500.0,        // K
                relief_pressure: 4.0e5,   // 4 bar
                pump_k: 0.1e5 / 1000.0,  // Pa per RPM → P_oil = K * rpm, clamped at relief
            },
            cooling: CoolingConfig {
                coolant_mass: 6.0,        // kg
                coolant_cp: 3400.0,       // J/(kg·K) — water-glycol mix
                radiator_effectiveness: 0.75,
                radiator_c_min: 500.0,    // W/K
                thermostat_open_temp: 363.0,
                thermostat_full_open_temp: 371.0,
                ambient_temperature: self.ambient_temperature,
                initial_coolant_temp: self.coolant_temperature,
            },
            ecu: EcuConfig {
                // 3×3 RPM×load spark maps (degrees BTDC)
                spark_map_rpm: vec![1000.0, 3000.0, 6000.0],
                spark_map_load: vec![0.2, 0.6, 1.0],
                spark_map_values: vec![
                    vec![10.0, 15.0, 20.0],
                    vec![20.0, 25.0, 30.0],
                    vec![30.0, 35.0, 38.0],
                ],
                // Lambda target map (1.0 = stoich)
                lambda_map_rpm: vec![1000.0, 3000.0, 6000.0],
                lambda_map_load: vec![0.2, 0.6, 1.0],
                lambda_map_values: vec![
                    vec![1.0, 1.0, 0.97],
                    vec![1.0, 1.0, 0.95],
                    vec![0.98, 0.97, 0.92],
                ],
                lambda_pi_kp: 0.1,
                lambda_pi_ki: 0.02,
                stft_clamp: 0.25,
                base_spark_advance: self.spark_advance,
            },
            cranktrain: CranktrainConfig {
                crankshaft_inertia: self.crankshaft_inertia,
                cylinder_count: self.cylinder_count as usize,
                firing_offsets_rad: self.firing_offsets(),
            },
            dyno: DynoConfig {
                max_rpm: self.max_rpm,
                idle_load_torque: self.idle_load_torque,
                dyno_gain: self.dyno_gain,
                dyno_integral_gain: self.dyno_integral_gain,
                dyno_load_torque: self.dyno_load_torque,
                dyno_mode: self.dyno_mode,
            },
        }
    }
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            bore: 0.086,
            stroke: 0.086,
            con_rod_length: 0.143,
            compression_ratio: 10.5,
            piston_mass: 0.350,
            con_rod_mass: 0.550,
            crankshaft_inertia: 0.15,
            ivo: 12.0,
            ivc: 40.0,
            evo: 40.0,
            evc: 12.0,
            max_intake_lift: 0.010,
            max_exhaust_lift: 0.009,
            afr: 14.7,
            fuel_lhv: 44_000_000.0,
            combustion_efficiency: 0.85,
            wiebe_a: 5.0,
            wiebe_m: 2.0,
            combustion_duration: 50.0,
            spark_advance: 25.0,
            ambient_pressure: 101_325.0,
            ambient_temperature: 300.0,
            ring_friction_coefficient: 0.08,
            viscous_friction: 50.0,
            wall_conductivity: 50.0,
            coolant_temperature: 363.0,
            max_rpm: 8000.0,
            idle_load_torque: 5.0,
            dyno_gain: 1.0,
            dyno_integral_gain: 0.5,
            dyno_load_torque: 10.0,
            throttle_diameter: 0.044,
            dyno_mode: 0,
            cylinder_count: 1,
            crank_offsets_deg: vec![],
        }
    }
}

// ── Hierarchical internal config ────────────────────────────────────────────

pub struct EngineParams {
    pub kinematics:    KinematicsConfig,
    pub combustion:    CombustionConfig,
    pub valve_train:   ValveTrainConfig,
    pub intake:        IntakeConfig,
    pub exhaust:       ExhaustConfig,
    pub heat_transfer: HeatTransferConfig,
    pub friction:      FrictionConfig,
    pub lubrication:   LubricationConfig,
    pub cooling:       CoolingConfig,
    pub ecu:           EcuConfig,
    pub cranktrain:    CranktrainConfig,
    pub dyno:          DynoConfig,
}

pub struct CranktrainConfig {
    pub crankshaft_inertia: f64,
    pub cylinder_count: usize,
    pub firing_offsets_rad: Vec<f64>,
}

pub struct DynoConfig {
    pub max_rpm: f64,
    pub idle_load_torque: f64,
    pub dyno_gain: f64,
    pub dyno_integral_gain: f64,
    pub dyno_load_torque: f64,
    pub dyno_mode: u8,
}
