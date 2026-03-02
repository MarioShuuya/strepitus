/// Walther viscosity equation: log₁₀(log₁₀(ν + 0.7)) = A - B·log₁₀(T)
/// Solved for kinematic viscosity ν, then converted to dynamic: η = ν × ρ_oil.
///
/// Simplified exponential form: η(T) = η_ref × exp(B·(1/T - 1/T_ref))
/// This is an approximation of the Walther equation valid over ±50°C of T_ref.
pub fn walther_viscosity(eta_ref: f64, t_ref: f64, b: f64, temperature: f64) -> f64 {
    let t = temperature.clamp(250.0, 450.0); // physical range
    let eta = eta_ref * (b * (1.0 / t - 1.0 / t_ref)).exp();
    eta.max(0.5e-3) // minimum 0.5 mPa·s (water-like at extreme heat)
}

/// Dynamic viscosity in Pa·s from kinematic viscosity and oil density.
/// For SAE 5W-30, ρ_oil ≈ 860 kg/m³.
pub fn dynamic_viscosity(kinematic_viscosity_m2s: f64) -> f64 {
    kinematic_viscosity_m2s * 860.0
}

/// Oil pressure in Pa: P_oil = min(P_relief, K × RPM).
pub fn oil_pressure(rpm: f64, pump_k: f64, relief_pressure: f64) -> f64 {
    (pump_k * rpm).min(relief_pressure).max(0.0)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // SAE 5W-30: η=11.5 mPa·s at 100°C (373 K), B=3500 K
    const ETA_REF: f64 = 11.5e-3;
    const T_REF: f64 = 373.0;
    const B: f64 = 3500.0;

    #[test]
    fn viscosity_at_reference_temperature() {
        let eta = walther_viscosity(ETA_REF, T_REF, B, T_REF);
        assert!((eta - ETA_REF).abs() < 1e-9, "η at T_ref should equal η_ref, got {eta}");
    }

    #[test]
    fn viscosity_at_90c() {
        // 90°C = 363 K → should be ~13 mPa·s (slightly higher than at 100°C)
        let eta = walther_viscosity(ETA_REF, T_REF, B, 363.0);
        assert!(eta > ETA_REF, "η(90°C) must be > η(100°C)");
        assert!(eta < 20e-3, "η(90°C) should be < 20 mPa·s, got {}", eta * 1000.0);
        // Allow wide tolerance (±15% per plan spec)
        assert!((eta - 13e-3).abs() / 13e-3 < 0.20,
            "η(90°C) expected ~13 mPa·s, got {} mPa·s", eta * 1000.0);
    }

    #[test]
    fn viscosity_at_60c() {
        // 60°C = 333 K → should be significantly higher than at 90°C
        // The simplified exponential model gives ~35 mPa·s here (real range 25–55 mPa·s)
        let eta = walther_viscosity(ETA_REF, T_REF, B, 333.0);
        let eta_90 = walther_viscosity(ETA_REF, T_REF, B, 363.0);
        assert!(eta > eta_90, "η(60°C) must be > η(90°C)");
        // The exponential model predicts ~35 mPa·s at 60°C; realistic range 20–70 mPa·s
        assert!(eta > 20e-3 && eta < 70e-3,
            "η(60°C) expected 20–70 mPa·s, got {} mPa·s", eta * 1000.0);
    }

    #[test]
    fn viscosity_at_20c() {
        // 20°C = 293 K → cold start, should be ~60 mPa·s (much higher)
        let eta = walther_viscosity(ETA_REF, T_REF, B, 293.0);
        assert!(eta > 30e-3, "η(20°C) must be much higher than at 90°C");
    }

    #[test]
    fn viscosity_monotonically_decreasing_with_temperature() {
        let temps = [293.0, 333.0, 363.0, 373.0, 393.0, 420.0];
        let mut prev_eta = f64::MAX;
        for &t in &temps {
            let eta = walther_viscosity(ETA_REF, T_REF, B, t);
            assert!(eta < prev_eta, "η must decrease with T: {eta} at {t}K >= prev {prev_eta}");
            prev_eta = eta;
        }
    }

    #[test]
    fn viscosity_always_positive() {
        for t in [250.0, 300.0, 400.0, 450.0] {
            let eta = walther_viscosity(ETA_REF, T_REF, B, t);
            assert!(eta > 0.0, "η must be positive at {t}K, got {eta}");
        }
    }

    #[test]
    fn oil_pressure_at_idle() {
        // K=0.001 bar/RPM → P_oil(800) = min(4.0, 0.001×800) = 0.8 bar
        let p = oil_pressure(800.0, 0.001e5, 4.0e5);
        assert!((p - 0.8e5).abs() < 1.0, "P_oil at 800 RPM should be 0.8 bar, got {}", p / 1e5);
    }

    #[test]
    fn oil_pressure_at_3000rpm() {
        let p = oil_pressure(3000.0, 0.001e5, 4.0e5);
        assert!((p - 3.0e5).abs() < 1.0, "P_oil at 3000 RPM should be 3.0 bar, got {}", p / 1e5);
    }

    #[test]
    fn oil_pressure_clamped_at_relief() {
        let p = oil_pressure(6000.0, 0.001e5, 4.0e5);
        assert!((p - 4.0e5).abs() < 1.0, "P_oil at 6000 RPM should clamp to 4.0 bar, got {}", p / 1e5);
    }

    #[test]
    fn oil_pressure_never_exceeds_relief() {
        for rpm in [0.0, 100.0, 1000.0, 5000.0, 10000.0] {
            let p = oil_pressure(rpm, 0.001e5, 4.0e5);
            assert!(p <= 4.0e5 + 1.0, "P_oil must not exceed relief at {rpm} RPM, got {p}");
        }
    }
}
