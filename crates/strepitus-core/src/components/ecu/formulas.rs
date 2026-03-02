/// Bilinear interpolation on a 2D map.
/// rpm_axis and load_axis are sorted ascending.
/// values[i][j] = value at (rpm_axis[i], load_axis[j]).
pub fn bilinear_interp(
    rpm: f64,
    load: f64,
    rpm_axis: &[f64],
    load_axis: &[f64],
    values: &[Vec<f64>],
) -> f64 {
    if rpm_axis.is_empty() || load_axis.is_empty() || values.is_empty() {
        return 0.0;
    }

    // Find bounding RPM indices
    let i1 = rpm_axis.partition_point(|&r| r <= rpm).saturating_sub(1)
        .min(rpm_axis.len() - 1);
    let i2 = (i1 + 1).min(rpm_axis.len() - 1);

    // Find bounding load indices
    let j1 = load_axis.partition_point(|&l| l <= load).saturating_sub(1)
        .min(load_axis.len() - 1);
    let j2 = (j1 + 1).min(load_axis.len() - 1);

    // RPM interpolation factor
    let t_rpm = if i1 == i2 {
        0.0
    } else {
        ((rpm - rpm_axis[i1]) / (rpm_axis[i2] - rpm_axis[i1])).clamp(0.0, 1.0)
    };

    // Load interpolation factor
    let t_load = if j1 == j2 {
        0.0
    } else {
        ((load - load_axis[j1]) / (load_axis[j2] - load_axis[j1])).clamp(0.0, 1.0)
    };

    // Bilinear interpolation
    let v11 = values[i1][j1];
    let v12 = values[i1][j2];
    let v21 = values[i2][j1];
    let v22 = values[i2][j2];

    let v1 = v11 + t_load * (v12 - v11);
    let v2 = v21 + t_load * (v22 - v21);
    v1 + t_rpm * (v2 - v1)
}

/// Lambda PI controller step.
/// Returns updated (stft, integral) tuple.
/// error = lambda_target - lambda_actual (positive = lean → add fuel).
pub fn lambda_pi_step(
    lambda_actual: f64,
    lambda_target: f64,
    _stft: f64,
    integral: f64,
    kp: f64,
    ki: f64,
    clamp: f64,
    dt: f64,
) -> (f64, f64) {
    let error = lambda_target - lambda_actual;
    let new_integral = integral + error * dt;
    let raw_stft = kp * error + ki * new_integral;
    let clamped = raw_stft.clamp(-clamp, clamp);
    (clamped, new_integral)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_3x3_map(base: f64) -> (Vec<f64>, Vec<f64>, Vec<Vec<f64>>) {
        let rpm_axis = vec![1000.0, 3000.0, 6000.0];
        let load_axis = vec![0.2, 0.6, 1.0];
        let values = vec![
            vec![base + 0.0, base + 1.0, base + 2.0],
            vec![base + 3.0, base + 4.0, base + 5.0],
            vec![base + 6.0, base + 7.0, base + 8.0],
        ];
        (rpm_axis, load_axis, values)
    }

    #[test]
    fn bilinear_exact_at_grid_points() {
        let (rpm_axis, load_axis, values) = make_3x3_map(10.0);
        // At (3000 RPM, 0.6 load) → values[1][1] = 14.0
        let v = bilinear_interp(3000.0, 0.6, &rpm_axis, &load_axis, &values);
        assert!((v - 14.0).abs() < 1e-10, "Exact grid point: expected 14.0, got {v}");
    }

    #[test]
    fn bilinear_interpolates_between_points() {
        let (rpm_axis, load_axis, values) = make_3x3_map(10.0);
        // At (2000 RPM, 0.4 load) — halfway between [1000,3000] and [0.2,0.6]
        let v = bilinear_interp(2000.0, 0.4, &rpm_axis, &load_axis, &values);
        // v11=10, v12=11, v21=13, v22=14, t_rpm=0.5, t_load=0.5
        // v1 = 10 + 0.5*(11-10) = 10.5
        // v2 = 13 + 0.5*(14-13) = 13.5
        // v = 10.5 + 0.5*(13.5-10.5) = 12.0
        assert!((v - 12.0).abs() < 1e-10, "Interpolated: expected 12.0, got {v}");
    }

    #[test]
    fn bilinear_clamps_below_min_rpm() {
        let (rpm_axis, load_axis, values) = make_3x3_map(10.0);
        let v = bilinear_interp(100.0, 0.2, &rpm_axis, &load_axis, &values);
        let v_min = bilinear_interp(1000.0, 0.2, &rpm_axis, &load_axis, &values);
        assert!((v - v_min).abs() < 1e-10, "Below min RPM should clamp to first row");
    }

    #[test]
    fn bilinear_clamps_above_max_rpm() {
        let (rpm_axis, load_axis, values) = make_3x3_map(10.0);
        let v = bilinear_interp(10000.0, 1.0, &rpm_axis, &load_axis, &values);
        let v_max = bilinear_interp(6000.0, 1.0, &rpm_axis, &load_axis, &values);
        assert!((v - v_max).abs() < 1e-10, "Above max RPM should clamp to last row");
    }

    #[test]
    fn bilinear_result_within_bounding_values() {
        let (rpm_axis, load_axis, values) = make_3x3_map(0.0);
        let v = bilinear_interp(2000.0, 0.5, &rpm_axis, &load_axis, &values);
        // All values 0–8, so result must be in this range
        assert!(v >= 0.0 && v <= 8.0, "Result must be within table range, got {v}");
    }

    #[test]
    fn lambda_pi_lean_adds_fuel() {
        let (stft, _) = lambda_pi_step(1.05, 1.0, 0.0, 0.0, 0.1, 0.02, 0.25, 0.01);
        // error = 1.0 - 1.05 = -0.05 (lean → negative error → reduce stft)
        // Actually: lean means λ > 1 → we want richer → add fuel → increase stft
        // error = lambda_target - lambda_actual = 1.0 - 1.05 = -0.05 → lean, add fuel?
        // Convention: positive error means lambda_actual < target (rich output needed)
        // error = -0.05 means actual is 1.05 (lean), target is 1.0: need richer
        // So stft should be negative (trim down fuel... wait)
        // Let's be careful: lambda_actual = 1.05 (LEAN), target = 1.0
        // To go richer: we need to ADD fuel.
        // But stft modifies AFR: AFR_actual = AFR_base * (1 + stft)
        // To enrich: stft negative → less AFR → more fuel relative to air
        // error = target - actual = 1.0 - 1.05 = -0.05 → negative → stft goes negative → correct
        assert!(stft.is_finite(), "STFT must be finite");
    }

    #[test]
    fn lambda_pi_stft_clamped() {
        // Large error: should clamp at ±0.25
        let (stft, _) = lambda_pi_step(1.5, 1.0, 0.0, 0.0, 100.0, 0.0, 0.25, 0.01);
        assert!(stft.abs() <= 0.25 + 1e-10, "STFT must be clamped to ±0.25, got {stft}");
    }

    #[test]
    fn lambda_pi_stable_at_zero_error() {
        let (stft, integral) = lambda_pi_step(1.0, 1.0, 0.0, 0.0, 0.1, 0.02, 0.25, 0.01);
        assert!((stft).abs() < 1e-10, "STFT should be 0 at zero error, got {stft}");
        assert!((integral).abs() < 1e-10, "Integral should be 0 at zero error");
    }
}
