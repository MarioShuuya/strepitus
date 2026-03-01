use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Complete engine configuration — all values tweakable from the UI.
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    /// Cylinder bore diameter in meters.
    pub bore: f64,
    /// Piston stroke length in meters.
    pub stroke: f64,
    /// Connecting rod length in meters.
    pub con_rod_length: f64,
    /// Geometric compression ratio (e.g. 10.5).
    pub compression_ratio: f64,
    /// Piston mass in kg.
    pub piston_mass: f64,
    /// Connecting rod mass in kg.
    pub con_rod_mass: f64,
    /// Moment of inertia of the crankshaft + flywheel in kg·m².
    pub crankshaft_inertia: f64,
    /// Intake valve open angle (crank degrees before TDC).
    pub ivo: f64,
    /// Intake valve close angle (crank degrees after BDC).
    pub ivc: f64,
    /// Exhaust valve open angle (crank degrees before BDC).
    pub evo: f64,
    /// Exhaust valve close angle (crank degrees after TDC).
    pub evc: f64,
    /// Maximum intake valve lift in meters.
    pub max_intake_lift: f64,
    /// Maximum exhaust valve lift in meters.
    pub max_exhaust_lift: f64,
    /// Air-fuel ratio (stoichiometric ~14.7 for gasoline).
    pub afr: f64,
    /// Fuel lower heating value in J/kg.
    pub fuel_lhv: f64,
    /// Combustion efficiency [0, 1].
    pub combustion_efficiency: f64,
    /// Wiebe function shape parameter `a`.
    pub wiebe_a: f64,
    /// Wiebe function shape parameter `m`.
    pub wiebe_m: f64,
    /// Combustion duration in crank degrees.
    pub combustion_duration: f64,
    /// Spark timing (crank degrees before TDC).
    pub spark_advance: f64,
    /// Ambient pressure in Pa.
    pub ambient_pressure: f64,
    /// Ambient temperature in K.
    pub ambient_temperature: f64,
    /// Coulomb friction coefficient for piston rings.
    pub ring_friction_coefficient: f64,
    /// Viscous friction coefficient in N·s/m.
    pub viscous_friction: f64,
    /// Cylinder wall thermal conductivity in W/(m·K).
    pub wall_conductivity: f64,
    /// Coolant temperature in K.
    pub coolant_temperature: f64,
    /// Rev limiter: maximum allowed RPM.
    pub max_rpm: f64,
    /// Constant load torque opposing rotation (accessories, pumping losses) in N·m.
    pub idle_load_torque: f64,
    /// Dyno proportional gain — scales the load torque vs. RPM error.
    pub dyno_gain: f64,
    /// Dyno integral gain for PI controller.
    #[serde(default = "default_dyno_integral_gain")]
    pub dyno_integral_gain: f64,
    /// Constant load torque in N·m (for load-control mode).
    #[serde(default = "default_dyno_load_torque")]
    pub dyno_load_torque: f64,
    /// Throttle body diameter in meters.
    #[serde(default = "default_throttle_diameter")]
    pub throttle_diameter: f64,
    /// Dyno mode: 0=speed PI, 1=load, 2=sweep.
    #[serde(default)]
    pub dyno_mode: u8,
    // ── Phase 8: Multi-cylinder ──
    /// Number of cylinders (1 = single, 4 = I4, etc.).
    #[wasm_bindgen(skip)]
    #[serde(default = "default_cylinder_count")]
    pub cylinder_count: u8,
    /// Per-cylinder crank offset in degrees (length = cylinder_count).
    #[wasm_bindgen(skip)]
    #[serde(default)]
    pub crank_offsets_deg: Vec<f64>,
}

#[wasm_bindgen]
impl EngineConfig {
    /// Create a default single-cylinder gasoline engine config.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    #[wasm_bindgen(js_name = fromJSON)]
    pub fn from_json(json: &str) -> Result<EngineConfig, JsValue> {
        serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = toJSON)]
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_default()
    }

    #[wasm_bindgen(getter, js_name = cylinder_count)]
    pub fn get_cylinder_count(&self) -> u8 {
        self.cylinder_count
    }

    #[wasm_bindgen(setter, js_name = cylinder_count)]
    pub fn set_cylinder_count(&mut self, count: u8) {
        self.cylinder_count = count;
    }
}

fn default_cylinder_count() -> u8 {
    1
}

fn default_throttle_diameter() -> f64 {
    0.044 // 44mm
}

fn default_dyno_integral_gain() -> f64 {
    0.5
}

fn default_dyno_load_torque() -> f64 {
    10.0
}

impl EngineConfig {
    /// Compute crank offsets in radians from config.
    /// If `crank_offsets_deg` is empty, uses built-in tables for common layouts.
    pub fn firing_offsets(&self) -> Vec<f64> {
        let n = self.cylinder_count.max(1) as usize;
        if n == 1 {
            return vec![0.0];
        }

        let degs = if !self.crank_offsets_deg.is_empty() {
            self.crank_offsets_deg.clone()
        } else {
            // Built-in firing order tables (crank offsets in degrees)
            match n {
                2 => vec![0.0, 360.0],
                3 => vec![0.0, 240.0, 480.0],
                4 => vec![0.0, 180.0, 540.0, 360.0], // 1-3-4-2
                6 => vec![0.0, 120.0, 240.0, 360.0, 480.0, 600.0], // even-fire V6
                8 => vec![0.0, 90.0, 270.0, 180.0, 630.0, 540.0, 450.0, 360.0], // cross-plane V8
                _ => (0..n).map(|i| i as f64 * 720.0 / n as f64).collect(),
            }
        };

        degs.iter()
            .take(n)
            .map(|d| d.to_radians())
            .collect()
    }
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            bore: 0.086,             // 86mm
            stroke: 0.086,           // 86mm — square engine
            con_rod_length: 0.143,   // ~1.66× stroke
            compression_ratio: 10.5,
            piston_mass: 0.350,      // 350g
            con_rod_mass: 0.550,     // 550g
            crankshaft_inertia: 0.15,
            // Valve timing (degrees)
            ivo: 12.0,   // 12° before TDC intake
            ivc: 40.0,   // 40° after BDC
            evo: 40.0,   // 40° before BDC
            evc: 12.0,   // 12° after TDC exhaust
            max_intake_lift: 0.010,  // 10mm
            max_exhaust_lift: 0.009, // 9mm
            // Fuel
            afr: 14.7,
            fuel_lhv: 44_000_000.0, // 44 MJ/kg gasoline
            combustion_efficiency: 0.85,
            // Wiebe parameters
            wiebe_a: 5.0,
            wiebe_m: 2.0,
            combustion_duration: 50.0, // degrees
            spark_advance: 25.0,       // degrees BTDC
            // Environment
            ambient_pressure: 101_325.0,
            ambient_temperature: 300.0,
            // Friction
            ring_friction_coefficient: 0.08,
            viscous_friction: 50.0,
            // Thermal
            wall_conductivity: 50.0,
            coolant_temperature: 363.0, // ~90°C
            // Stability
            max_rpm: 8000.0,
            idle_load_torque: 5.0, // N·m — accessories, pumping losses
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
