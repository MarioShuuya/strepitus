use super::formulas as f;
use super::interface::{ValveTrainConfig, ValveTrainInputs, ValveTrainOutputs};

/// Valve timing absolute angles in the 4-stroke cycle (0–720°).
///
/// Intake event:
///   Opens at: (720° - IVO) = ~708° (just before TDC of exhaust→intake)
///   Closes at: (180° + IVC) = ~220° (just after BDC)
///
/// Exhaust event:
///   Opens at: (540° - EVO) = ~500° (before BDC of power stroke)
///   Closes at: (720° + EVC) mod 720 ≈ EVC (just after TDC)
///
/// All angles are in the 0–720° convention where:
///   0°   = TDC (start of intake)
///   180° = BDC (end of intake, start of compression)
///   360° = TDC (end of compression, start of power, spark here)
///   540° = BDC (end of power, start of exhaust)
///   720° = TDC (end of exhaust, = 0° for next cycle)
pub fn step(cfg: &ValveTrainConfig, inputs: &ValveTrainInputs) -> ValveTrainOutputs {
    // Absolute valve event angles
    let intake_open  = 720.0 - cfg.ivo_deg; // IVO before TDC intake (overlaps with exhaust close)
    let intake_close = 180.0 + cfg.ivc_deg; // IVC after BDC
    let exhaust_open = 540.0 - cfg.evo_deg; // EVO before BDC
    let _exhaust_close = 720.0 + cfg.evc_deg; // EVC after TDC (wrap: handle as two segments)

    let crank = inputs.crank_angle_deg;

    // Intake lift: open window [intake_open, intake_close] OR [0, exhaust_close mod 720] for overlap
    let intake_lift = {
        // Main intake event
        let lift1 = f::polynomial_lift(crank, intake_open, 720.0, cfg.max_intake_lift);
        // Continuation into next cycle start (0 to IVC region)
        let lift2 = f::polynomial_lift(crank, 0.0, intake_close, cfg.max_intake_lift);
        // Also the full window if crank is between IVO and 720 OR 0 and IVC
        let lift_main = f::polynomial_lift(crank, intake_open, intake_close.min(720.0), cfg.max_intake_lift);
        lift1.max(lift2).max(lift_main)
    };

    // Exhaust lift: open window [exhaust_open, exhaust_close]
    // exhaust_close > 720 means it wraps into the next cycle start
    let exhaust_lift = {
        let lift1 = f::polynomial_lift(crank, exhaust_open, 720.0, cfg.max_exhaust_lift);
        let lift2 = f::polynomial_lift(crank, 0.0, cfg.evc_deg, cfg.max_exhaust_lift);
        lift1.max(lift2)
    };

    // Flow: intake (upstream = manifold, downstream = cylinder on intake stroke)
    let intake_cda = f::effective_flow_area(0.086, intake_lift); // bore approximate
    let exhaust_cda = f::effective_flow_area(0.086, exhaust_lift);

    let intake_flow = if intake_lift > 1e-6 {
        f::valve_mass_flow(intake_cda, inputs.upstream_pressure, inputs.downstream_pressure, inputs.upstream_temperature)
    } else {
        0.0
    };

    let exhaust_flow = if exhaust_lift > 1e-6 {
        f::valve_mass_flow(exhaust_cda, inputs.upstream_pressure, inputs.downstream_pressure, inputs.upstream_temperature)
    } else {
        0.0
    };

    ValveTrainOutputs {
        intake_lift,
        exhaust_lift,
        intake_mass_flow: intake_flow,
        exhaust_mass_flow: exhaust_flow,
        intake_cda,
        exhaust_cda,
    }
}
