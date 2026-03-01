use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Complete simulation state exported to JS each tick (single-cylinder).
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationState {
    /// Current crank angle in radians [0, 4π) for 4-stroke.
    pub crank_angle: f64,
    /// Piston position from TDC in meters.
    pub piston_position: f64,
    /// Cylinder pressure in Pascals.
    pub cylinder_pressure: f64,
    /// Cylinder gas temperature in Kelvin.
    pub gas_temperature: f64,
    /// Cylinder wall temperature in Kelvin.
    pub wall_temperature: f64,
    /// Instantaneous torque in N·m.
    pub torque: f64,
    /// Engine speed in RPM.
    pub rpm: f64,
    /// Current stroke phase (0=intake, 1=compression, 2=power, 3=exhaust).
    pub stroke_phase: u8,
    /// Intake valve lift in meters.
    pub intake_valve_lift: f64,
    /// Exhaust valve lift in meters.
    pub exhaust_valve_lift: f64,
    /// Combustion progress [0, 1].
    pub burn_fraction: f64,
    /// Cylinder volume in m³.
    pub cylinder_volume: f64,
    // ── Phase 5: Force fields ──
    /// Gas pressure force on piston in N (positive = pushing piston down).
    pub gas_force: f64,
    /// Reciprocating inertia force in N.
    pub inertia_force: f64,
    /// Piston friction force in N.
    pub friction_force: f64,
    // ── Phase 6: Audio params ──
    /// Combustion impulse intensity [0, 1].
    pub combustion_intensity: f64,
    /// Exhaust pulse intensity [0, 1].
    pub exhaust_intensity: f64,
    /// Mechanical noise level [0, 1].
    pub mechanical_noise: f64,
    /// Engine cycle frequency in Hz (RPM / 120 for 4-stroke).
    pub cycle_frequency: f64,
    /// Cycle-averaged torque in N·m (updated once per complete 720° cycle).
    pub cycle_avg_torque: f64,
    /// Intake manifold pressure in Pa.
    pub manifold_pressure: f64,
}

#[wasm_bindgen]
impl SimulationState {
    #[wasm_bindgen(js_name = toJSON)]
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

impl Default for SimulationState {
    fn default() -> Self {
        Self {
            crank_angle: 0.0,
            piston_position: 0.0,
            cylinder_pressure: 101_325.0,
            gas_temperature: 300.0,
            wall_temperature: 360.0,
            torque: 0.0,
            rpm: 0.0,
            stroke_phase: 0,
            intake_valve_lift: 0.0,
            exhaust_valve_lift: 0.0,
            burn_fraction: 0.0,
            cylinder_volume: 0.0,
            gas_force: 0.0,
            inertia_force: 0.0,
            friction_force: 0.0,
            combustion_intensity: 0.0,
            exhaust_intensity: 0.0,
            mechanical_noise: 0.0,
            cycle_frequency: 0.0,
            cycle_avg_torque: 0.0,
            manifold_pressure: 101_325.0,
        }
    }
}

// ── Per-cylinder snapshot (Phase 8) ────────────────────────────────

/// Per-cylinder data snapshot. Not directly wasm_bindgen — serialized via JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CylinderSnapshot {
    pub crank_angle: f64,
    pub piston_position: f64,
    pub cylinder_pressure: f64,
    pub gas_temperature: f64,
    pub wall_temperature: f64,
    pub stroke_phase: u8,
    pub intake_valve_lift: f64,
    pub exhaust_valve_lift: f64,
    pub burn_fraction: f64,
    pub cylinder_volume: f64,
    pub gas_force: f64,
    pub inertia_force: f64,
    pub friction_force: f64,
}

// ── Multi-cylinder state (Phase 8) ─────────────────────────────────

/// Multi-cylinder engine state exported to JS each tick.
#[wasm_bindgen]
pub struct MultiCylinderState {
    pub rpm: f64,
    pub total_torque: f64,
    pub cylinder_count: u8,
    pub combustion_intensity: f64,
    pub exhaust_intensity: f64,
    pub mechanical_noise: f64,
    pub cycle_frequency: f64,
    /// Cycle-averaged torque in N·m (updated once per complete 720° cycle).
    pub cycle_avg_torque: f64,
    /// Intake manifold pressure in Pa.
    pub manifold_pressure: f64,
    #[wasm_bindgen(skip)]
    pub snapshots: Vec<CylinderSnapshot>,
}

#[wasm_bindgen]
impl MultiCylinderState {
    /// Get per-cylinder data as a JSON string (array of CylinderSnapshot).
    #[wasm_bindgen(js_name = cylindersJSON)]
    pub fn cylinders_json(&self) -> String {
        serde_json::to_string(&self.snapshots).unwrap_or_default()
    }
}

impl MultiCylinderState {
    pub fn default_for(n: usize) -> Self {
        Self {
            rpm: 0.0,
            total_torque: 0.0,
            cylinder_count: n as u8,
            combustion_intensity: 0.0,
            exhaust_intensity: 0.0,
            mechanical_noise: 0.0,
            cycle_frequency: 0.0,
            cycle_avg_torque: 0.0,
            manifold_pressure: 101_325.0,
            snapshots: Vec::new(),
        }
    }
}
