// types.rs — WASM-facing render state + internal snapshot structs

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// ── Per-cylinder snapshot (internal, serialized for WASM Tier 2) ─────────

/// Per-cylinder data snapshot. Not directly wasm_bindgen — serialized via JSON.
/// Field layout is identical to the previous CylinderSnapshot so JS renderer
/// code requires no changes.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
    pub exhaust_pulse_intensity: f64,
    pub exhaust_gas_temp: f64,
}

// ── Engine-level snapshot (internal, not directly exported) ─────────────

pub struct EngineSnapshot {
    pub rpm: f64,
    pub total_torque: f64,
    pub cycle_avg_torque: f64,
    pub combustion_intensity: f64,
    pub exhaust_intensity: f64,
    pub mechanical_noise: f64,
    pub cycle_frequency: f64,
    pub manifold_pressure: f64,
    pub snapshots: Vec<CylinderSnapshot>,
    pub coolant_temperature: f64,
    pub oil_pressure: f64,
    pub oil_viscosity: f64,
}

// ── Single-cylinder render state (WASM Tier 1, 60fps) ───────────────────

/// Complete simulation state exported to JS each tick (single-cylinder).
/// Field names identical to previous SimulationState — JS renderer unchanged.
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationState {
    pub crank_angle: f64,
    pub piston_position: f64,
    pub cylinder_pressure: f64,
    pub gas_temperature: f64,
    pub wall_temperature: f64,
    pub torque: f64,
    pub rpm: f64,
    pub stroke_phase: u8,
    pub intake_valve_lift: f64,
    pub exhaust_valve_lift: f64,
    pub burn_fraction: f64,
    pub cylinder_volume: f64,
    pub gas_force: f64,
    pub inertia_force: f64,
    pub friction_force: f64,
    pub combustion_intensity: f64,
    pub exhaust_intensity: f64,
    pub mechanical_noise: f64,
    pub cycle_frequency: f64,
    pub cycle_avg_torque: f64,
    pub manifold_pressure: f64,
    pub exhaust_pulse_intensity: f64,
    pub exhaust_gas_temp: f64,
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
            exhaust_pulse_intensity: 0.0,
            exhaust_gas_temp: 300.0,
        }
    }
}

// ── Multi-cylinder render state (WASM Tier 1, 60fps) ────────────────────

/// Multi-cylinder engine state exported to JS each tick.
/// Field names and cylindersFlat() layout identical to previous MultiCylinderState.
#[wasm_bindgen]
pub struct MultiCylinderState {
    pub rpm: f64,
    pub total_torque: f64,
    pub cylinder_count: u8,
    pub combustion_intensity: f64,
    pub exhaust_intensity: f64,
    pub mechanical_noise: f64,
    pub cycle_frequency: f64,
    pub cycle_avg_torque: f64,
    pub manifold_pressure: f64,
    #[wasm_bindgen(skip)]
    pub snapshots: Vec<CylinderSnapshot>,
}

#[wasm_bindgen]
impl MultiCylinderState {
    #[wasm_bindgen(js_name = cylindersJSON)]
    pub fn cylinders_json(&self) -> String {
        serde_json::to_string(&self.snapshots).unwrap_or_default()
    }

    /// Pack per-cylinder data into flat Vec<f64> for fast WASM→JS transport.
    /// ⚠ SYNC: Field order must match `CYLINDER_FLAT_FIELDS` in web/src/main.ts
    #[wasm_bindgen(js_name = cylindersFlat)]
    pub fn cylinders_flat(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.snapshots.len() * 15);
        for s in &self.snapshots {
            out.push(s.crank_angle);
            out.push(s.piston_position);
            out.push(s.cylinder_pressure);
            out.push(s.gas_temperature);
            out.push(s.wall_temperature);
            out.push(s.stroke_phase as f64);
            out.push(s.intake_valve_lift);
            out.push(s.exhaust_valve_lift);
            out.push(s.burn_fraction);
            out.push(s.cylinder_volume);
            out.push(s.gas_force);
            out.push(s.inertia_force);
            out.push(s.friction_force);
            out.push(s.exhaust_pulse_intensity);
            out.push(s.exhaust_gas_temp);
        }
        out
    }
}

impl MultiCylinderState {
    pub fn from_engine_snapshot(snap: &EngineSnapshot) -> Self {
        Self {
            rpm: snap.rpm,
            total_torque: snap.total_torque,
            cylinder_count: snap.snapshots.len() as u8,
            combustion_intensity: snap.combustion_intensity,
            exhaust_intensity: snap.exhaust_intensity,
            mechanical_noise: snap.mechanical_noise,
            cycle_frequency: snap.cycle_frequency,
            cycle_avg_torque: snap.cycle_avg_torque,
            manifold_pressure: snap.manifold_pressure,
            snapshots: snap.snapshots.clone(),
        }
    }

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
