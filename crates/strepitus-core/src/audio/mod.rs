use wasm_bindgen::prelude::*;

/// Audio parameter output from the physics engine.
/// The actual synthesis happens in JS via Web Audio API.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct AudioParams {
    /// Combustion impulse intensity [0, 1].
    pub combustion_intensity: f64,
    /// Exhaust pulse intensity [0, 1].
    pub exhaust_intensity: f64,
    /// Mechanical noise level [0, 1].
    pub mechanical_noise: f64,
    /// Engine cycle frequency in Hz (RPM / 120 for 4-stroke).
    pub cycle_frequency: f64,
}

impl AudioParams {
    pub fn from_state(
        rpm: f64,
        cylinder_pressure: f64,
        ambient_pressure: f64,
        stroke_phase: u8,
        _burn_fraction: f64,
        exhaust_valve_lift: f64,
    ) -> Self {
        // Combustion intensity: pressure spike relative to ambient
        let pressure_ratio = cylinder_pressure / ambient_pressure;
        let combustion_intensity = if stroke_phase == 2 {
            ((pressure_ratio - 1.0) / 40.0).clamp(0.0, 1.0)
        } else {
            0.0
        };

        // Exhaust intensity: proportional to valve opening and pressure
        let exhaust_intensity = if exhaust_valve_lift > 0.001 {
            (exhaust_valve_lift / 0.01 * (pressure_ratio - 1.0) / 5.0).clamp(0.0, 1.0)
        } else {
            0.0
        };

        // Mechanical noise: proportional to RPM
        let mechanical_noise = (rpm / 6000.0).clamp(0.0, 1.0) * 0.3;

        // Cycle frequency for 4-stroke: one power stroke per 2 revolutions
        let cycle_frequency = rpm / 120.0;

        Self {
            combustion_intensity,
            exhaust_intensity,
            mechanical_noise,
            cycle_frequency,
        }
    }
}
