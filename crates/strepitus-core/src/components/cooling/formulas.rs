/// Thermostat opening fraction [0, 1].
/// Linear interpolation between T_open and T_full_open.
pub fn thermostat_opening(t_coolant: f64, t_open: f64, t_full_open: f64) -> f64 {
    if t_coolant <= t_open { return 0.0; }
    if t_coolant >= t_full_open { return 1.0; }
    (t_coolant - t_open) / (t_full_open - t_open)
}

/// Radiator heat rejection using NTU-effectiveness method.
/// Q_radiator = ε × thermostat_opening × C_min × (T_coolant - T_ambient)
pub fn radiator_heat_rejection(
    effectiveness: f64,
    thermostat_opening: f64,
    c_min: f64,
    t_coolant: f64,
    t_ambient: f64,
) -> f64 {
    if t_coolant <= t_ambient { return 0.0; }
    (effectiveness * thermostat_opening * c_min * (t_coolant - t_ambient)).max(0.0)
}

/// Coolant temperature ODE step.
/// dT_coolant/dt = (Q_wall_to_coolant - Q_radiator) / (m_coolant × Cp)
pub fn coolant_temp_ode(
    t_coolant: f64,
    q_wall: f64,
    q_radiator: f64,
    mass: f64,
    cp: f64,
    dt: f64,
) -> f64 {
    let c = mass * cp;
    let dt_cool = (q_wall - q_radiator) / c;
    (t_coolant + dt_cool * dt).max(250.0)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const T_OPEN: f64 = 363.0;   // 90°C
    const T_FULL: f64 = 371.0;   // 98°C

    #[test]
    fn thermostat_closed_below_threshold() {
        assert_eq!(thermostat_opening(355.0, T_OPEN, T_FULL), 0.0);
        assert_eq!(thermostat_opening(363.0, T_OPEN, T_FULL), 0.0);
    }

    #[test]
    fn thermostat_midpoint() {
        let mid = (T_OPEN + T_FULL) / 2.0; // 367 K
        let opening = thermostat_opening(mid, T_OPEN, T_FULL);
        assert!((opening - 0.5).abs() < 1e-10, "Thermostat at midpoint = {opening}");
    }

    #[test]
    fn thermostat_fully_open() {
        assert_eq!(thermostat_opening(371.0, T_OPEN, T_FULL), 1.0);
        assert_eq!(thermostat_opening(380.0, T_OPEN, T_FULL), 1.0, "Clamp at 1.0 above T_full");
    }

    #[test]
    fn thermostat_in_0_1() {
        for t_i in 0..=500 {
            let t = 300.0 + t_i as f64;
            let o = thermostat_opening(t, T_OPEN, T_FULL);
            assert!(o >= 0.0 && o <= 1.0, "Thermostat opening must be in [0,1], got {o} at {t}K");
        }
    }

    #[test]
    fn radiator_heat_rejection_realistic() {
        // T_coolant=363K, T_ambient=293K, C_min=500 W/K, ε=0.75, opening=1.0
        let q = radiator_heat_rejection(0.75, 1.0, 500.0, 363.0, 293.0);
        // 0.75 × 500 × 70 = 26,250 W
        assert!((q - 26250.0).abs() < 10.0, "Radiator power should be ~26.25 kW, got {q} W");
    }

    #[test]
    fn radiator_zero_when_equal_temperature() {
        let q = radiator_heat_rejection(0.75, 1.0, 500.0, 293.0, 293.0);
        assert_eq!(q, 0.0, "No radiator heat when T_coolant = T_ambient");
    }

    #[test]
    fn radiator_zero_when_thermostat_closed() {
        let q = radiator_heat_rejection(0.75, 0.0, 500.0, 400.0, 293.0);
        assert_eq!(q, 0.0, "No radiator heat when thermostat closed");
    }

    #[test]
    fn coolant_temp_rises_with_heat_input() {
        let m = 6.0;
        let cp = 3400.0;
        let t0 = 350.0;
        // Q_wall=10kW, Q_rad=0 → should rise
        let t1 = coolant_temp_ode(t0, 10000.0, 0.0, m, cp, 1.0);
        assert!(t1 > t0, "Coolant must warm when Q_in > Q_out");
        // Rate: 10000 / (6×3400) ≈ 0.49 K/s
        let rate = t1 - t0;
        assert!((rate - 0.49).abs() < 0.05, "Warming rate should be ~0.49 K/s, got {rate}");
    }

    #[test]
    fn coolant_temp_stable_at_equilibrium() {
        let t0 = 363.0;
        let t1 = coolant_temp_ode(t0, 1000.0, 1000.0, 6.0, 3400.0, 1.0);
        assert!((t1 - t0).abs() < 1e-10, "Coolant temp stable at equilibrium");
    }
}
