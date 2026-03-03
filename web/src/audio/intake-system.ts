/**
 * Intake system audio simulation.
 * Signal chain: oscillator + noise → per-cyl pulse gains → inductionBus →
 *   runner resonance peaking EQ → plenum lowpass → air filter lowpass → outputGain
 *
 * Pulsation events fire on intake_pulse threshold crossing per cylinder (mirrors
 * ExhaustSystem impulse pattern). Runner resonance creates an induction "honk"
 * at f = 343 / (4 × L_runner). Air filter cutoff varies by filter type.
 */

import type { CylinderAudio } from "./synthesizer";

/** CylinderAudio extended with intake acoustic fields derived in main.ts */
export interface CylinderAudioExtended extends CylinderAudio {
  piston_side_force: number;   // normalized [0,1]
  intake_closing_speed: number; // m/s — valve seat impact
  exhaust_closing_speed: number; // m/s — valve seat impact
  intake_pulse: number;         // [0,1] — induction event magnitude
}

export class IntakeSystem {
  private ctx: AudioContext;
  private noiseBuffer: AudioBuffer;

  // Oscillator (firing_freq × 0.5) for tonal induction body
  private oscillator: OscillatorNode | null = null;
  private oscGain: GainNode | null = null;

  // Broadband noise for rush texture
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;

  // Merge bus — osc + noise + per-cyl pulses flow here
  private inductionBus: GainNode | null = null;

  // [1] Runner resonance: peaking EQ at f = 343 / (4 × L_runner)
  private runnerEQ: BiquadFilterNode | null = null;

  // [2] Plenum lowpass at 1200 Hz
  private plenumLP: BiquadFilterNode | null = null;

  // [3] Air filter lowpass (cutoff depends on filter type)
  private airFilterLP: BiquadFilterNode | null = null;

  // Per-cylinder impulse envelope gains → inductionBus
  private pulseGains: GainNode[] = [];
  private prevIntakePulse: number[] = [];

  // Output gain (channel volume control)
  private outputGain: GainNode;

  constructor(ctx: AudioContext, noiseBuffer: AudioBuffer) {
    this.ctx = ctx;
    this.noiseBuffer = noiseBuffer;
    this.outputGain = ctx.createGain();
    this.outputGain.gain.value = 1.0;
    this.build();
  }

  private build(): void {
    const ctx = this.ctx;

    // [3] Air filter LP → outputGain
    this.airFilterLP = ctx.createBiquadFilter();
    this.airFilterLP.type = "lowpass";
    this.airFilterLP.frequency.value = 2500; // stock default
    this.airFilterLP.Q.value = 0.7;
    this.airFilterLP.connect(this.outputGain);

    // [2] Plenum LP → airFilterLP
    this.plenumLP = ctx.createBiquadFilter();
    this.plenumLP.type = "lowpass";
    this.plenumLP.frequency.value = 1200;
    this.plenumLP.Q.value = 0.7;
    this.plenumLP.connect(this.airFilterLP);

    // [1] Runner resonance peaking EQ → plenumLP
    this.runnerEQ = ctx.createBiquadFilter();
    this.runnerEQ.type = "peaking";
    this.runnerEQ.frequency.value = 286; // 343 / (4 × 0.3m)
    this.runnerEQ.Q.value = 3.0;
    this.runnerEQ.gain.value = 8.0; // dB
    this.runnerEQ.connect(this.plenumLP);

    // Induction bus → runnerEQ (always gain 1; per-element gains control level)
    this.inductionBus = ctx.createGain();
    this.inductionBus.gain.value = 1.0;
    this.inductionBus.connect(this.runnerEQ);

    // Oscillator → oscGain → inductionBus
    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0.0;
    this.oscGain.connect(this.inductionBus);

    this.oscillator = ctx.createOscillator();
    this.oscillator.type = "sawtooth";
    this.oscillator.frequency.value = 40;
    this.oscillator.connect(this.oscGain);
    this.oscillator.start();

    // Noise → noiseGain → inductionBus
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.0;
    this.noiseGain.connect(this.inductionBus);

    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = this.noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseGain);
    this.noiseSource.start();
  }

  getOutput(): GainNode {
    return this.outputGain;
  }

  /**
   * Update intake audio state each frame.
   * @param rpm            Engine RPM
   * @param cylinders      Per-cylinder audio data (must include intake_pulse field)
   * @param channelVolume  Mixer volume for this channel [0,1]
   * @param runnerLengthM  Intake runner length in metres (default 0.3 = 300 mm)
   * @param filterType     Air filter: 0=stock (2500 Hz), 1=sport (4000 Hz), 2=open (6000 Hz)
   */
  update(
    rpm: number,
    cylinders: CylinderAudioExtended[],
    channelVolume: number,
    runnerLengthM: number,
    filterType: number,
  ): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = cylinders.length;
    const tau = 0.03;

    // Grow / shrink per-cylinder tracker arrays
    while (this.prevIntakePulse.length < n) this.prevIntakePulse.push(0);
    if (this.prevIntakePulse.length > n) this.prevIntakePulse.length = n;

    // Grow pulse gain nodes
    while (this.pulseGains.length < n) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.inductionBus!);
      this.pulseGains.push(g);
    }
    // Shrink — disconnect extras
    while (this.pulseGains.length > n) {
      const g = this.pulseGains.pop()!;
      g.disconnect();
    }

    // Runner resonance frequency: f = c / (4 × L)
    const fRunner = 343 / (4 * Math.max(0.05, runnerLengthM));
    this.runnerEQ!.frequency.setTargetAtTime(fRunner, t, tau);

    // Air filter cutoff
    const filterCutoff = filterType === 2 ? 6000 : filterType === 1 ? 4000 : 2500;
    this.airFilterLP!.frequency.setTargetAtTime(filterCutoff, t, tau);

    // Oscillator: half the per-cylinder firing frequency
    const firingFreqHz = rpm / 60 / 2; // 4-stroke: half-crankshaft speed
    this.oscillator!.frequency.setTargetAtTime(Math.max(5, firingFreqHz * 0.5), t, tau);

    // RPM-dependent impulse decay (shorter at high RPM)
    const decayTime = Math.max(0.02, 0.06 - (rpm / 8000) * 0.04);
    const pulseThreshold = 0.005;

    // Per-cylinder induction pulse firing
    for (let ci = 0; ci < n; ci++) {
      const pulse = cylinders[ci].intake_pulse ?? 0;
      const prev = this.prevIntakePulse[ci];
      const rising = pulse > pulseThreshold && prev <= pulseThreshold;
      this.prevIntakePulse[ci] = pulse;

      if (rising) {
        const staggerSec = ci * (60 / Math.max(rpm, 100) / n);
        const fireT = t + staggerSec;
        // ~6 dB quieter than exhaust
        const peakGain = Math.min(pulse * 0.35, 0.35) / Math.sqrt(n) * channelVolume;

        const g = this.pulseGains[ci].gain;
        if (typeof g.cancelAndHoldAtTime === "function") {
          g.cancelAndHoldAtTime(fireT);
        } else {
          g.cancelScheduledValues(fireT);
          g.setValueAtTime(g.value, fireT);
        }
        // Pre-attack at 20%, main attack, exponential decay
        g.linearRampToValueAtTime(peakGain * 0.2, fireT + 0.0005);
        g.linearRampToValueAtTime(peakGain, fireT + 0.002);
        g.exponentialRampToValueAtTime(0.001, fireT + 0.002 + decayTime);
      }
    }

    // Continuous induction rush: noise + osc scale with max intake_pulse
    let maxPulse = 0;
    for (let ci = 0; ci < n; ci++) {
      const p = cylinders[ci].intake_pulse ?? 0;
      if (p > maxPulse) maxPulse = p;
    }
    const rushLevel = Math.min(maxPulse * 0.4, 0.2) * channelVolume;
    this.noiseGain!.gain.setTargetAtTime(rushLevel, t, 0.05);
    this.oscGain!.gain.setTargetAtTime(rushLevel * 0.4, t, 0.05);
  }

  dispose(): void {
    this.oscillator?.stop();
    this.noiseSource?.stop();
    for (const g of this.pulseGains) g.disconnect();
    this.pulseGains = [];
    this.prevIntakePulse = [];
    this.oscillator = null;
    this.noiseSource = null;
    this.noiseGain = null;
    this.oscGain = null;
    this.inductionBus = null;
    this.runnerEQ = null;
    this.plenumLP = null;
    this.airFilterLP = null;
  }
}
