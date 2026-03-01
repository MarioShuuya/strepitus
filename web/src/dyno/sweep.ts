/**
 * Dyno sweep state machine — ramps through RPM range, collects cycle-averaged
 * torque from the engine, computes torque/power curve.
 *
 * The engine itself computes cycle_avg_torque (integrated over complete 720°
 * cycles in Rust). The sweep just holds each RPM step long enough to stabilize,
 * then samples the engine-reported average.
 */

export interface SweepConfig {
  startRpm: number;
  endRpm: number;
  stepRpm: number;
  holdTime: number;   // seconds to hold each RPM step (settle + sample)
  sampleTime: number; // seconds at end of hold to collect samples
}

export interface SweepDataPoint {
  rpm: number;
  avgTorque: number;
  powerKw: number;
}

type SweepState = "idle" | "holding" | "sampling" | "done";

export class DynoSweep {
  private config: SweepConfig;
  private state: SweepState = "idle";
  private currentRpm = 0;
  private timer = 0;
  private data: SweepDataPoint[] = [];

  // Collect cycle_avg_torque samples during sample window
  private samples: number[] = [];

  onProgress: ((pct: number) => void) | null = null;
  onComplete: ((data: SweepDataPoint[]) => void) | null = null;

  private setTargetRpmFn: ((rpm: number) => void) | null = null;
  private setDynoModeFn: ((mode: number) => void) | null = null;

  constructor(config: SweepConfig) {
    this.config = config;
  }

  start(setTargetRpm: (rpm: number) => void, setDynoMode: (mode: number) => void): void {
    this.setTargetRpmFn = setTargetRpm;
    this.setDynoModeFn = setDynoMode;
    this.data = [];
    this.currentRpm = this.config.startRpm;
    this.timer = 0;
    this.samples = [];

    // Use speed PI mode (mode 2 = sweep, same PI logic)
    setDynoMode(2);
    setTargetRpm(this.currentRpm);
    this.state = "holding";
  }

  /**
   * Called each frame with the engine's cycle-averaged torque.
   * cycleAvgTorque comes from SimulationState.cycle_avg_torque or
   * MultiCylinderState.cycle_avg_torque — computed in Rust over complete
   * 720° engine cycles.
   */
  tick(dt: number, cycleAvgTorque: number): void {
    if (this.state === "idle" || this.state === "done") return;

    this.timer += dt;

    if (this.state === "holding") {
      const holdOnly = this.config.holdTime - this.config.sampleTime;
      if (this.timer >= holdOnly) {
        this.state = "sampling";
        this.samples = [];
      }
    }

    if (this.state === "sampling") {
      this.samples.push(cycleAvgTorque);

      if (this.timer >= this.config.holdTime) {
        // Average the cycle_avg_torque samples collected during the window
        const avgTorque = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        const powerKw = avgTorque * this.currentRpm / 9549;

        this.data.push({
          rpm: this.currentRpm,
          avgTorque: Math.max(0, avgTorque),
          powerKw: Math.max(0, powerKw),
        });

        // Advance to next step
        this.currentRpm += this.config.stepRpm;

        const totalSteps = (this.config.endRpm - this.config.startRpm) / this.config.stepRpm;
        const completedSteps = this.data.length;
        this.onProgress?.(completedSteps / totalSteps);

        if (this.currentRpm > this.config.endRpm) {
          this.state = "done";
          // Restore speed control mode
          this.setDynoModeFn?.(0);
          this.onComplete?.(this.data);
          return;
        }

        // Set next target
        this.setTargetRpmFn?.(this.currentRpm);
        this.timer = 0;
        this.samples = [];
        this.state = "holding";
      }
    }
  }

  get isActive(): boolean {
    return this.state === "holding" || this.state === "sampling";
  }

  get progress(): number {
    if (this.state === "done") return 1;
    const totalSteps = (this.config.endRpm - this.config.startRpm) / this.config.stepRpm;
    return this.data.length / totalSteps;
  }
}
