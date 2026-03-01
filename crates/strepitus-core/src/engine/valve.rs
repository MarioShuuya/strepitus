use crate::engine::config::EngineConfig;

/// Valve train model with cam profile approximation.
pub struct ValveTrain;

impl ValveTrain {
    /// Calculate intake valve lift at a given 4-stroke crank angle (0–720°).
    /// Uses a sinusoidal cam profile approximation.
    pub fn intake_lift(config: &EngineConfig, crank_angle_deg: f64) -> f64 {
        // Intake opens at (360 - ivo) degrees, closes at (540 + ivc) degrees
        // (in 720° 4-stroke cycle, 360° = TDC intake stroke)
        let open = 360.0 - config.ivo;
        let close = 540.0 + config.ivc;

        Self::valve_lift(crank_angle_deg, open, close, config.max_intake_lift)
    }

    /// Calculate exhaust valve lift at a given 4-stroke crank angle (0–720°).
    pub fn exhaust_lift(config: &EngineConfig, crank_angle_deg: f64) -> f64 {
        // Exhaust opens at (540 - evo) degrees, closes at (720 + evc) degrees
        let open = 540.0 - config.evo;
        let close = 720.0 + config.evc;

        Self::valve_lift(crank_angle_deg, open, close, config.max_exhaust_lift)
    }

    /// Generic sinusoidal valve lift profile.
    fn valve_lift(crank_angle_deg: f64, open_deg: f64, close_deg: f64, max_lift: f64) -> f64 {
        // Normalize angle to [0, 720)
        let angle = ((crank_angle_deg % 720.0) + 720.0) % 720.0;

        // Handle wrap-around (exhaust close > 720)
        let in_range = if close_deg > 720.0 {
            angle >= open_deg || angle <= (close_deg - 720.0)
        } else {
            angle >= open_deg && angle <= close_deg
        };

        if !in_range {
            return 0.0;
        }

        // Map position within the open window to [0, π] for a sine profile
        let duration = if close_deg > 720.0 {
            close_deg - open_deg
        } else {
            close_deg - open_deg
        };

        let progress = if angle >= open_deg {
            angle - open_deg
        } else {
            angle + 720.0 - open_deg
        };

        let normalized = progress / duration * std::f64::consts::PI;
        max_lift * normalized.sin()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> EngineConfig {
        EngineConfig::default()
    }

    #[test]
    fn intake_closed_during_compression() {
        let cfg = default_config();
        // Compression stroke: ~220° to ~340° (well past IVC at 180+40=220°)
        for deg in [250.0, 300.0, 340.0] {
            let lift = ValveTrain::intake_lift(&cfg, deg);
            assert!(lift.abs() < 1e-10, "Intake should be closed at {deg}°, got {lift}");
        }
    }

    #[test]
    fn exhaust_closed_during_compression() {
        let cfg = default_config();
        for deg in [200.0, 270.0, 340.0] {
            let lift = ValveTrain::exhaust_lift(&cfg, deg);
            assert!(lift.abs() < 1e-10, "Exhaust should be closed at {deg}°, got {lift}");
        }
    }

    #[test]
    fn intake_open_during_intake_stroke() {
        let cfg = default_config();
        // Intake stroke midpoint: ~450° (360+90)
        let lift = ValveTrain::intake_lift(&cfg, 450.0);
        assert!(lift > 0.005, "Intake should be well open at 450°, got {lift}");
    }

    #[test]
    fn exhaust_open_during_exhaust_stroke() {
        let cfg = default_config();
        // Exhaust stroke midpoint: ~630° (540+90)
        let lift = ValveTrain::exhaust_lift(&cfg, 630.0);
        assert!(lift > 0.005, "Exhaust should be well open at 630°, got {lift}");
    }

    #[test]
    fn max_intake_lift_not_exceeded() {
        let cfg = default_config();
        for deg in 0..720 {
            let lift = ValveTrain::intake_lift(&cfg, deg as f64);
            assert!(lift <= cfg.max_intake_lift + 1e-10,
                "Intake lift exceeds max at {deg}°: {lift}");
        }
    }

    #[test]
    fn max_exhaust_lift_not_exceeded() {
        let cfg = default_config();
        for deg in 0..720 {
            let lift = ValveTrain::exhaust_lift(&cfg, deg as f64);
            assert!(lift <= cfg.max_exhaust_lift + 1e-10,
                "Exhaust lift exceeds max at {deg}°: {lift}");
        }
    }

    #[test]
    fn valve_lift_never_negative() {
        let cfg = default_config();
        for deg in 0..720 {
            let il = ValveTrain::intake_lift(&cfg, deg as f64);
            let el = ValveTrain::exhaust_lift(&cfg, deg as f64);
            assert!(il >= 0.0, "Negative intake lift at {deg}°");
            assert!(el >= 0.0, "Negative exhaust lift at {deg}°");
        }
    }
}
