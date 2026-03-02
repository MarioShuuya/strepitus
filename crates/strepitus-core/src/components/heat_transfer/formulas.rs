use std::f64::consts::PI;

/// Full Woschni correlation (Woschni 1967/1978 with C2 firing correction).
///
/// h = 3.26 · B^(-0.2) · P^0.8 · T^(-0.55) · w^0.8  [W/(m²·K)]
///
/// where w = C1·v_mean + C2·(V_d·T_1)/(P_1·V_1) · (P - P_motored)
///
/// P must be in Pa (NOT kPa — Woschni original uses kPa, so we divide by 1000).
/// Returns h in W/(m²·K).
pub fn woschni_h(
    bore: f64,
    cylinder_pressure: f64,
    gas_temperature: f64,
    mean_piston_speed: f64,
    pressure_motored: f64,
    displacement_volume: f64,
    tdc_pressure: f64,
    tdc_temperature: f64,
    cylinder_volume: f64,
    c1: f64,
    c2: f64,
) -> f64 {
    // Woschni gas velocity: w = C1·v_mean + C2·(Vd·T1)/(P1·V1)·(P - P_motored)
    let delta_p = (cylinder_pressure - pressure_motored).max(0.0);
    let firing_term = if tdc_pressure > 1e3 && tdc_temperature > 100.0 && cylinder_volume > 1e-9 {
        c2 * (displacement_volume * tdc_temperature) / (tdc_pressure * cylinder_volume) * delta_p
    } else {
        0.0
    };
    let w = (c1 * mean_piston_speed + firing_term).max(1.0); // prevent zero velocity

    // Convert pressure to kPa for the Woschni constant 3.26
    let p_kpa = cylinder_pressure / 1000.0;

    let h = 3.26
        * bore.powf(-0.2)
        * p_kpa.powf(0.8)
        * gas_temperature.powf(-0.55)
        * w.powf(0.8);

    h.max(0.0)
}

/// Instantaneous surface area of combustion chamber in m².
/// A = 2 × A_piston + π × bore × cylinder_height
/// cylinder_height derived from volume: h = V / A_piston
pub fn surface_area(bore: f64, cylinder_volume: f64) -> f64 {
    let a_piston = PI / 4.0 * bore * bore;
    let height = cylinder_volume / a_piston;
    2.0 * a_piston + PI * bore * height
}

/// Heat transferred from gas to wall in J.
/// Q = h · A · (T_gas - T_wall) · dt
pub fn q_gas_to_wall(h: f64, area: f64, t_gas: f64, t_wall: f64, dt: f64) -> f64 {
    h * area * (t_gas - t_wall) * dt
}

/// Heat transferred from wall to coolant in J.
/// Newton cooling with coolant-side convection coefficient ~750 W/(m²·K).
pub fn q_wall_to_coolant(bore: f64, stroke: f64, t_wall: f64, t_coolant: f64, dt: f64) -> f64 {
    let h_coolant = 750.0;
    let outer_area = PI * bore * stroke * 1.5;
    h_coolant * outer_area * (t_wall - t_coolant) * dt
}

/// Wall temperature ODE step: integrate dT_wall/dt = (Q_gas - Q_coolant) / C_wall.
pub fn wall_temp_ode(t_wall: f64, q_gas: f64, q_coolant: f64, thermal_mass: f64, dt: f64) -> f64 {
    let dq = q_gas - q_coolant;
    (t_wall + dq / thermal_mass * dt).max(200.0)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn woschni_h_in_typical_range() {
        // B=0.086m, P=1MPa, T=600K, v_mean=10m/s (C1 × vmean), no firing correction
        let h = woschni_h(
            0.086,
            1e6,    // Pa
            600.0,  // K
            10.0 / 2.28, // v_mean such that C1*v_mean=10
            1e6,    // P_motored = P (no delta_P)
            500e-6, // Vd
            1e6,    // P1
            600.0,  // T1
            100e-6, // V cylinder
            2.28,
            3.24e-3,
        );
        assert!(h > 0.0, "h must be positive, got {h}");
        // At these conditions (1 MPa, 600K) h is typically 200–800 W/(m²·K)
        assert!(h > 100.0 && h < 2000.0, "h = {} W/(m²·K), expected 100–2000", h);
    }

    #[test]
    fn woschni_h_increases_with_pressure() {
        let h1 = woschni_h(0.086, 1e6, 600.0, 5.0, 1e6, 500e-6, 1e6, 600.0, 100e-6, 2.28, 3.24e-3);
        let h2 = woschni_h(0.086, 2e6, 600.0, 5.0, 2e6, 500e-6, 2e6, 600.0, 100e-6, 2.28, 3.24e-3);
        assert!(h2 > h1, "h should increase with pressure: h1={h1}, h2={h2}");
    }

    #[test]
    fn woschni_h_decreases_with_temperature() {
        let h1 = woschni_h(0.086, 1e6, 500.0, 5.0, 1e6, 500e-6, 1e6, 500.0, 100e-6, 2.28, 3.24e-3);
        let h2 = woschni_h(0.086, 1e6, 1000.0, 5.0, 1e6, 500e-6, 1e6, 1000.0, 100e-6, 2.28, 3.24e-3);
        assert!(h1 > h2, "h should decrease with temperature: h500={h1}, h1000={h2}");
    }

    #[test]
    fn surface_area_positive_and_increases_from_tdc() {
        let a_tdc = surface_area(0.086, 52.6e-6); // clearance volume
        let a_bdc = surface_area(0.086, 552.3e-6); // clearance + displacement
        assert!(a_tdc > 0.0, "Surface area must be positive at TDC");
        assert!(a_bdc > a_tdc, "Surface area must increase from TDC to BDC");
    }

    #[test]
    fn q_gas_to_wall_positive_when_gas_hotter() {
        let q = q_gas_to_wall(500.0, 0.01, 800.0, 400.0, 1e-3);
        assert!(q > 0.0, "Heat must flow from hot gas to cool wall, got {q}");
    }

    #[test]
    fn q_gas_to_wall_negative_when_wall_hotter() {
        let q = q_gas_to_wall(500.0, 0.01, 300.0, 500.0, 1e-3);
        assert!(q < 0.0, "Heat must flow from hot wall to cool gas, got {q}");
    }

    #[test]
    fn wall_temp_ode_increases_when_q_in_gt_q_out() {
        let t0 = 400.0;
        let t1 = wall_temp_ode(t0, 100.0, 10.0, 5000.0, 1.0);
        assert!(t1 > t0, "Wall temp must rise when Q_in > Q_out");
    }

    #[test]
    fn wall_temp_ode_stable_at_equilibrium() {
        let t0 = 400.0;
        let t1 = wall_temp_ode(t0, 50.0, 50.0, 5000.0, 1.0);
        assert!((t1 - t0).abs() < 1e-10, "Wall temp must be stable at Q_in = Q_out");
    }
}
