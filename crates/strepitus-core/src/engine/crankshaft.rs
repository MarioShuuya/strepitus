use crate::engine::config::EngineConfig;

/// Crank-slider kinematics: converts crank angle to piston displacement and velocity.
pub struct Crankshaft;

impl Crankshaft {
    /// Crank radius (half of stroke).
    #[inline]
    pub fn crank_radius(config: &EngineConfig) -> f64 {
        config.stroke / 2.0
    }

    /// Rod ratio λ = crank_radius / con_rod_length.
    #[inline]
    pub fn rod_ratio(config: &EngineConfig) -> f64 {
        Self::crank_radius(config) / config.con_rod_length
    }

    /// Piston position from TDC (meters). 0 = TDC, positive = toward BDC.
    /// Uses the exact crank-slider equation:
    ///   x = r·(1 - cosθ) + l·(1 - √(1 - λ²·sin²θ))
    pub fn piston_position(config: &EngineConfig, crank_angle: f64) -> f64 {
        let r = Self::crank_radius(config);
        let lambda = Self::rod_ratio(config);
        let sin_theta = crank_angle.sin();
        let cos_theta = crank_angle.cos();

        r * (1.0 - cos_theta)
            + config.con_rod_length * (1.0 - (1.0 - lambda * lambda * sin_theta * sin_theta).sqrt())
    }

    /// Piston velocity (m/s) given crank angle and angular velocity (rad/s).
    pub fn piston_velocity(config: &EngineConfig, crank_angle: f64, omega: f64) -> f64 {
        let r = Self::crank_radius(config);
        let lambda = Self::rod_ratio(config);
        let sin_theta = crank_angle.sin();
        let cos_theta = crank_angle.cos();

        let denom = (1.0 - lambda * lambda * sin_theta * sin_theta).sqrt();

        omega * r * (sin_theta + lambda * sin_theta * cos_theta / denom)
    }

    /// Piston acceleration (m/s²) — second-order approximation.
    pub fn piston_acceleration(config: &EngineConfig, crank_angle: f64, omega: f64) -> f64 {
        let r = Self::crank_radius(config);
        let lambda = Self::rod_ratio(config);

        omega * omega * r * (crank_angle.cos() + lambda * (2.0 * crank_angle).cos())
    }

    /// Stroke volume (displaced volume) of one cylinder in m³.
    pub fn displacement(config: &EngineConfig) -> f64 {
        let area = std::f64::consts::PI / 4.0 * config.bore * config.bore;
        area * config.stroke
    }

    /// Clearance volume (combustion chamber volume at TDC) in m³.
    pub fn clearance_volume(config: &EngineConfig) -> f64 {
        Self::displacement(config) / (config.compression_ratio - 1.0)
    }

    /// Instantaneous cylinder volume at given crank angle in m³.
    pub fn cylinder_volume(config: &EngineConfig, crank_angle: f64) -> f64 {
        let bore_area = std::f64::consts::PI / 4.0 * config.bore * config.bore;
        Self::clearance_volume(config) + bore_area * Self::piston_position(config, crank_angle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> EngineConfig {
        EngineConfig::default()
    }

    #[test]
    fn piston_at_tdc_is_zero() {
        let cfg = default_config();
        let pos = Crankshaft::piston_position(&cfg, 0.0);
        assert!(pos.abs() < 1e-10, "Piston at TDC should be 0, got {pos}");
    }

    #[test]
    fn piston_at_bdc_equals_stroke() {
        let cfg = default_config();
        let pos = Crankshaft::piston_position(&cfg, std::f64::consts::PI);
        let diff = (pos - cfg.stroke).abs();
        assert!(diff < 1e-10, "Piston at BDC should equal stroke ({:.4}), got {pos:.4}", cfg.stroke);
    }

    #[test]
    fn piston_position_always_positive() {
        let cfg = default_config();
        for deg in 0..360 {
            let angle = (deg as f64).to_radians();
            let pos = Crankshaft::piston_position(&cfg, angle);
            assert!(pos >= -1e-10, "Piston position negative at {deg}°: {pos}");
        }
    }

    #[test]
    fn piston_position_never_exceeds_stroke() {
        let cfg = default_config();
        for deg in 0..360 {
            let angle = (deg as f64).to_radians();
            let pos = Crankshaft::piston_position(&cfg, angle);
            assert!(pos <= cfg.stroke + 1e-10, "Piston exceeds stroke at {deg}°: {pos}");
        }
    }

    #[test]
    fn velocity_zero_at_tdc_and_bdc() {
        let cfg = default_config();
        let omega = 100.0; // arbitrary
        let v_tdc = Crankshaft::piston_velocity(&cfg, 0.0, omega);
        let v_bdc = Crankshaft::piston_velocity(&cfg, std::f64::consts::PI, omega);
        assert!(v_tdc.abs() < 1e-10, "Velocity at TDC should be ~0, got {v_tdc}");
        assert!(v_bdc.abs() < 1e-10, "Velocity at BDC should be ~0, got {v_bdc}");
    }

    #[test]
    fn displacement_matches_manual_calc() {
        let cfg = default_config();
        let expected = std::f64::consts::PI / 4.0 * 0.086 * 0.086 * 0.086;
        let disp = Crankshaft::displacement(&cfg);
        let diff = (disp - expected).abs();
        assert!(diff < 1e-10, "Displacement mismatch: expected {expected:.6e}, got {disp:.6e}");
    }

    #[test]
    fn volume_at_tdc_equals_clearance() {
        let cfg = default_config();
        let v_tdc = Crankshaft::cylinder_volume(&cfg, 0.0);
        let v_clear = Crankshaft::clearance_volume(&cfg);
        let diff = (v_tdc - v_clear).abs();
        assert!(diff < 1e-12, "Volume at TDC should equal clearance volume");
    }

    #[test]
    fn volume_at_bdc_equals_clearance_plus_displacement() {
        let cfg = default_config();
        let v_bdc = Crankshaft::cylinder_volume(&cfg, std::f64::consts::PI);
        let expected = Crankshaft::clearance_volume(&cfg) + Crankshaft::displacement(&cfg);
        let diff = (v_bdc - expected).abs();
        assert!(diff < 1e-12, "Volume at BDC should equal clearance + displacement");
    }

    #[test]
    fn compression_ratio_from_volumes() {
        let cfg = default_config();
        let v_bdc = Crankshaft::cylinder_volume(&cfg, std::f64::consts::PI);
        let v_tdc = Crankshaft::cylinder_volume(&cfg, 0.0);
        let cr = v_bdc / v_tdc;
        let diff = (cr - cfg.compression_ratio).abs();
        assert!(diff < 1e-10, "CR should be {}, got {cr}", cfg.compression_ratio);
    }
}
