use std::f64::consts::PI;

/// Crank radius in meters. r = stroke / 2.
#[inline]
pub fn crank_radius(stroke: f64) -> f64 {
    stroke / 2.0
}

/// Rod ratio λ = r / l (dimensionless).
#[inline]
pub fn rod_ratio(crank_radius: f64, con_rod_length: f64) -> f64 {
    crank_radius / con_rod_length
}

/// Displacement volume per cylinder in m³.
/// V_d = (π/4) × bore² × stroke
#[inline]
pub fn displacement_volume(bore: f64, stroke: f64) -> f64 {
    PI / 4.0 * bore * bore * stroke
}

/// Clearance volume in m³.
/// V_c = V_d / (CR - 1)
#[inline]
pub fn clearance_volume(bore: f64, stroke: f64, compression_ratio: f64) -> f64 {
    displacement_volume(bore, stroke) / (compression_ratio - 1.0)
}

/// Piston position from TDC in meters.
/// Exact crank-slider model:
///   x = r·(1 - cosθ) + l·(1 - √(1 - λ²·sin²θ))
/// Returns 0 at TDC (θ=0), stroke at BDC (θ=π).
#[inline]
pub fn piston_position(crank_angle_rad: f64, r: f64, l: f64, lambda: f64) -> f64 {
    let theta = crank_angle_rad;
    r * (1.0 - theta.cos()) + l * (1.0 - (1.0 - lambda * lambda * theta.sin() * theta.sin()).sqrt())
}

/// Piston velocity in m/s (positive = moving toward BDC).
/// dx/dθ × ω, where dx/dθ = r·(sinθ + λ·sinθ·cosθ / √(1 - λ²·sin²θ))
#[inline]
pub fn piston_velocity(crank_angle_rad: f64, omega: f64, r: f64, lambda: f64) -> f64 {
    let theta = crank_angle_rad;
    let sin_t = theta.sin();
    let cos_t = theta.cos();
    let denom = (1.0 - lambda * lambda * sin_t * sin_t).sqrt().max(1e-12);
    omega * r * (sin_t + lambda * sin_t * cos_t / denom)
}

/// Piston acceleration in m/s².
/// Exact analytic derivative of piston_velocity with respect to time:
///   a = ω² × r × [cosθ + λ(cos²θ - sin²θ + λ²sin⁴θ) / (1 - λ²sin²θ)^(3/2)]
#[inline]
pub fn piston_accel(crank_angle_rad: f64, omega: f64, r: f64, lambda: f64) -> f64 {
    let theta = crank_angle_rad;
    let sin_t = theta.sin();
    let cos_t = theta.cos();
    let sin2 = sin_t * sin_t;
    let lam2 = lambda * lambda;
    let inner = (1.0 - lam2 * sin2).max(1e-24);
    let denom = inner * inner.sqrt(); // (1 - λ²sin²θ)^(3/2)

    // Numerator of the λ correction term: (cos²θ - sin²θ)·(1-λ²sin²θ) + λ²sin²θcos²θ
    //   = cos²θ - sin²θ + λ²sin⁴θ
    let numerator = lambda * (cos_t * cos_t - sin2 + lam2 * sin2 * sin2);

    omega * omega * r * (cos_t + numerator / denom)
}

/// Cylinder volume in m³.
/// V = V_clearance + (π/4)·bore²·piston_position
#[inline]
pub fn cylinder_volume(piston_pos: f64, bore: f64, clearance_vol: f64) -> f64 {
    clearance_vol + PI / 4.0 * bore * bore * piston_pos
}

/// Stroke phase from crank angle in the 4-stroke cycle [0, 4π).
/// 0=intake [0,π), 1=compression [π,2π), 2=power [2π,3π), 3=exhaust [3π,4π)
#[inline]
pub fn stroke_phase(crank_angle_rad: f64) -> u8 {
    let angle_4stroke = crank_angle_rad % (4.0 * std::f64::consts::PI);
    (angle_4stroke / std::f64::consts::PI) as u8
}

/// Torque arm: converts piston force (N) to crankshaft torque (N·m).
/// τ = F × r × sin(θ + β) / cos(β),  β = arcsin(λ·sinθ)
/// At TDC (θ=0) and BDC (θ=π): torque arm = 0.
#[inline]
pub fn torque_arm(crank_angle_rad: f64, r: f64, lambda: f64) -> f64 {
    let theta = crank_angle_rad;
    let sin_t = theta.sin();
    let beta_arg = (lambda * sin_t).clamp(-1.0, 1.0);
    let beta = beta_arg.asin();
    let cos_beta = beta.cos().max(1e-12);
    r * (theta + beta).sin() / cos_beta
}

/// Piston area in m².
#[inline]
pub fn piston_area(bore: f64) -> f64 {
    PI / 4.0 * bore * bore
}

/// Reciprocating mass in kg: piston + 1/3 of connecting rod.
#[inline]
pub fn recip_mass(piston_mass: f64, con_rod_mass: f64) -> f64 {
    piston_mass + con_rod_mass / 3.0
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // FA20-style parameters from research-simulation/01, /03
    const BORE: f64 = 0.086;
    const STROKE: f64 = 0.086;
    const CON_ROD: f64 = 0.143;
    const CR: f64 = 10.5;

    fn params() -> (f64, f64, f64) {
        let r = crank_radius(STROKE);
        let l = CON_ROD;
        let lambda = rod_ratio(r, l);
        (r, l, lambda)
    }

    #[test]
    fn crank_radius_half_stroke() {
        assert!((crank_radius(STROKE) - 0.043).abs() < 1e-10);
    }

    #[test]
    fn rod_ratio_correct() {
        let r = crank_radius(STROKE);
        let lambda = rod_ratio(r, CON_ROD);
        // 43/143 = 0.3007
        assert!((lambda - 43.0 / 143.0).abs() < 1e-6);
    }

    #[test]
    fn displacement_500cc() {
        let vd = displacement_volume(BORE, STROKE);
        // π/4 × 0.086² × 0.086 ≈ 499.7 cm³
        assert!((vd * 1e6 - 499.7).abs() < 0.5, "Displacement = {} cm³", vd * 1e6);
    }

    #[test]
    fn clearance_volume_correct() {
        let vc = clearance_volume(BORE, STROKE, CR);
        let vd = displacement_volume(BORE, STROKE);
        // vc = vd / (CR - 1) ≈ 52.6 cm³
        assert!((vc - vd / (CR - 1.0)).abs() < 1e-12);
        assert!((vc * 1e6 - 52.6).abs() < 0.5, "Clearance = {} cm³", vc * 1e6);
    }

    #[test]
    fn piston_at_tdc_is_zero() {
        let (r, l, lambda) = params();
        let pos = piston_position(0.0, r, l, lambda);
        assert!(pos.abs() < 1e-10, "Position at TDC should be 0, got {pos}");
    }

    #[test]
    fn piston_at_bdc_is_stroke() {
        let (r, l, lambda) = params();
        let pos = piston_position(PI, r, l, lambda);
        assert!((pos - STROKE).abs() < 1e-6, "Position at BDC should be stroke={STROKE}, got {pos}");
    }

    #[test]
    fn piston_velocity_zero_at_tdc() {
        let (r, _, lambda) = params();
        let v = piston_velocity(0.0, 100.0, r, lambda);
        assert!(v.abs() < 1e-10, "Velocity at TDC should be 0, got {v}");
    }

    #[test]
    fn piston_velocity_zero_at_bdc() {
        let (r, _, lambda) = params();
        let v = piston_velocity(PI, 100.0, r, lambda);
        assert!(v.abs() < 1e-6, "Velocity at BDC should be 0, got {v}");
    }

    #[test]
    fn cylinder_volume_at_tdc_is_clearance() {
        let (r, l, lambda) = params();
        let vc = clearance_volume(BORE, STROKE, CR);
        let pos = piston_position(0.0, r, l, lambda);
        let vol = cylinder_volume(pos, BORE, vc);
        assert!((vol - vc).abs() < 1e-12, "Volume at TDC should equal clearance {vc}, got {vol}");
    }

    #[test]
    fn cylinder_volume_at_bdc() {
        let (r, l, lambda) = params();
        let vc = clearance_volume(BORE, STROKE, CR);
        let vd = displacement_volume(BORE, STROKE);
        let pos = piston_position(PI, r, l, lambda);
        let vol = cylinder_volume(pos, BORE, vc);
        let expected = vc + vd;
        assert!((vol - expected).abs() < 1e-9, "Volume at BDC = {vol}, expected {expected}");
    }

    #[test]
    fn piston_accel_vs_finite_diff() {
        let (r, _, lambda) = params();
        let omega = 300.0; // rad/s ≈ 2865 RPM
        let dtheta = 1e-5;
        let mut max_rel_err: f64 = 0.0;
        for i in 0..50 {
            let theta = i as f64 * PI / 25.0; // 50 samples around full revolution
            let v_plus = piston_velocity(theta + dtheta, omega, r, lambda);
            let v_minus = piston_velocity(theta - dtheta, omega, r, lambda);
            let fd_accel = (v_plus - v_minus) / (2.0 * dtheta) * omega; // dv/dt = dv/dθ × ω
            let analytic = piston_accel(theta, omega, r, lambda);
            if analytic.abs() > 1.0 {
                let rel_err = ((analytic - fd_accel) / analytic).abs();
                max_rel_err = max_rel_err.max(rel_err);
            }
        }
        assert!(max_rel_err < 1e-4, "Piston accel vs FD: max relative error = {max_rel_err}");
    }

    #[test]
    fn torque_arm_zero_at_tdc_bdc() {
        let (r, _, lambda) = params();
        let arm_tdc = torque_arm(0.0, r, lambda);
        let arm_bdc = torque_arm(PI, r, lambda);
        assert!(arm_tdc.abs() < 1e-10, "Torque arm at TDC should be 0, got {arm_tdc}");
        assert!(arm_bdc.abs() < 1e-6, "Torque arm at BDC should be 0, got {arm_bdc}");
    }

    #[test]
    fn torque_arm_max_between_60_90_deg() {
        let (r, _, lambda) = params();
        let arm_max = (0..90)
            .map(|deg| torque_arm((deg as f64).to_radians(), r, lambda).abs())
            .fold(0.0_f64, f64::max);
        let arm_early = torque_arm(30.0_f64.to_radians(), r, lambda).abs();
        let arm_late = torque_arm(100.0_f64.to_radians(), r, lambda).abs();
        // Max should be between 60–90° (i.e., greater than arm at 30° or at 100°)
        assert!(arm_max > arm_early, "Max torque arm should exceed arm at 30°");
        assert!(arm_max > arm_late, "Max torque arm should exceed arm at 100°");
    }

    #[test]
    fn stroke_phase_correct() {
        assert_eq!(stroke_phase(0.5 * PI), 0);           // intake
        assert_eq!(stroke_phase(1.5 * PI), 1);           // compression
        assert_eq!(stroke_phase(2.5 * PI), 2);           // power
        assert_eq!(stroke_phase(3.5 * PI), 3);           // exhaust
    }
}
