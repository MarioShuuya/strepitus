/**
 * Procedural engine sound synthesis via Web Audio API.
 * Impulsive combustion pops with noise burst, intake air rush, split mechanical noise,
 * compression whoosh, and valve click detection.
 * Per-cylinder firing detection for multi-cylinder support.
 */

import { ExhaustSystem } from "./exhaust-system";
import { defaultExhaustConfig, type ExhaustSystemConfig } from "./exhaust-config";

const ATM = 101325; // atmospheric pressure in Pa

export interface CylinderAudio {
  combustion_intensity: number; // [0,1]
  stroke_phase: number;         // 0-3
  intake_valve_lift: number;    // meters
  exhaust_valve_lift: number;   // meters
  burn_fraction: number;        // [0,1]
  cylinder_pressure: number;    // Pa
  exhaust_pulse_intensity: number; // [0,1]
  exhaust_gas_temp: number;     // K
}

export interface SynthParams {
  mechanical_noise: number;
  cycle_frequency: number;
  rpm: number;
  cylinders: CylinderAudio[];
}

/** Compute combustion_intensity from raw cylinder snapshot data (mirrors Rust AudioParams::from_state). */
export function cylinderCombustion(pressure: number, strokePhase: number): number {
  if (strokePhase !== 2) return 0;
  const ratio = pressure / ATM;
  return Math.min(Math.max((ratio - 1) / 40, 0), 1);
}

export interface ChannelInfo {
  id: string;
  label: string;
  color: string;
  enabled: boolean;
  volume: number;
}

interface ChannelEntry {
  id: string;
  label: string;
  color: string;
  enabled: boolean;
  volume: number;
  gainNode: GainNode | null;
}

export class EngineSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Channel registry — auto-discovered by mixer UI
  private _channels: ChannelEntry[] = [];

  // Combustion: 4 oscillators with envelope-triggered firing
  private combOsc: OscillatorNode[] = [];
  private combGains: GainNode[] = []; // per-oscillator envelope gains
  private combustionBus: GainNode | null = null;

  // Combustion noise burst: noise → highpass → gain → combustionBus
  private combNoiseSource: AudioBufferSourceNode | null = null;
  private combNoiseFilter: BiquadFilterNode | null = null;
  private combNoiseGain: GainNode | null = null;

  // Intake: noise → bandpass → gain
  private intakeSource: AudioBufferSourceNode | null = null;
  private intakeFilter: BiquadFilterNode | null = null;
  private intakeGain: GainNode | null = null;

  // Mechanical: shared noise → two parallel bandpass chains
  private mechSource: AudioBufferSourceNode | null = null;
  private valveFilter: BiquadFilterNode | null = null;
  private valveGain: GainNode | null = null;
  private valveBus: GainNode | null = null; // Bus for valve train + valve clicks
  private pistonFilter: BiquadFilterNode | null = null;
  private pistonGain: GainNode | null = null;

  // Compression whoosh: noise → lowpass → gain
  private compSource: AudioBufferSourceNode | null = null;
  private compFilter: BiquadFilterNode | null = null;
  private compGain: GainNode | null = null;

  // Valve click: noise → bandpass(5kHz) → gain
  private valveClickSource: AudioBufferSourceNode | null = null;
  private valveClickFilter: BiquadFilterNode | null = null;
  private valveClickGain: GainNode | null = null;

  // Exhaust system
  private exhaustSystem: ExhaustSystem | null = null;

  // Per-cylinder combustion tracking for firing edge detection
  private prevCombPerCyl: number[] = [];
  // Per-cylinder valve lift tracking for click detection
  private prevIntakeLift: number[] = [];
  private prevExhaustLift: number[] = [];
  private _muted = false;
  private _volume = 0.3;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    this.ctx = new AudioContext();
    const ctx = this.ctx;

    // Master gain
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this._volume;
    this.masterGain.connect(ctx.destination);

    // --- Combustion chain ---
    this.combustionBus = ctx.createGain();
    this.combustionBus.gain.value = 1.0;
    this.combustionBus.connect(this.masterGain);

    // 4 harmonics: sub-bass sine, 2nd sawtooth, 3rd sawtooth, 4th sine
    const types: OscillatorType[] = ["sine", "sawtooth", "sawtooth", "sine"];
    const freqMultipliers = [1, 2, 3, 4];
    const baseFreq = 30;

    for (let i = 0; i < 4; i++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.combustionBus);

      const osc = ctx.createOscillator();
      osc.type = types[i];
      osc.frequency.value = baseFreq * freqMultipliers[i];
      osc.connect(gain);
      osc.start();

      this.combOsc.push(osc);
      this.combGains.push(gain);
    }

    // --- Shared noise buffer ---
    const noiseBuffer = this.createNoiseBuffer(ctx, 2);

    // --- Combustion noise burst chain ---
    this.combNoiseFilter = ctx.createBiquadFilter();
    this.combNoiseFilter.type = "highpass";
    this.combNoiseFilter.frequency.value = 500;

    this.combNoiseGain = ctx.createGain();
    this.combNoiseGain.gain.value = 0;
    this.combNoiseFilter.connect(this.combNoiseGain);
    this.combNoiseGain.connect(this.combustionBus);

    this.combNoiseSource = ctx.createBufferSource();
    this.combNoiseSource.buffer = noiseBuffer;
    this.combNoiseSource.loop = true;
    this.combNoiseSource.connect(this.combNoiseFilter);
    this.combNoiseSource.start();

    // --- Intake air rush chain ---
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = "bandpass";
    this.intakeFilter.frequency.value = 1000;
    this.intakeFilter.Q.value = 1.5;

    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.intakeFilter.connect(this.intakeGain);
    this.intakeGain.connect(this.masterGain);

    this.intakeSource = ctx.createBufferSource();
    this.intakeSource.buffer = noiseBuffer;
    this.intakeSource.loop = true;
    this.intakeSource.connect(this.intakeFilter);
    this.intakeSource.start();

    // --- Mechanical noise: valve train chain ---
    this.valveBus = ctx.createGain();
    this.valveBus.gain.value = 1.0;
    this.valveBus.connect(this.masterGain);

    this.valveFilter = ctx.createBiquadFilter();
    this.valveFilter.type = "bandpass";
    this.valveFilter.frequency.value = 3500;
    this.valveFilter.Q.value = 3;

    this.valveGain = ctx.createGain();
    this.valveGain.gain.value = 0;
    this.valveFilter.connect(this.valveGain);
    this.valveGain.connect(this.valveBus);

    // --- Mechanical noise: piston/wrist pin chain ---
    this.pistonFilter = ctx.createBiquadFilter();
    this.pistonFilter.type = "bandpass";
    this.pistonFilter.frequency.value = 1200;
    this.pistonFilter.Q.value = 1.5;

    this.pistonGain = ctx.createGain();
    this.pistonGain.gain.value = 0;
    this.pistonFilter.connect(this.pistonGain);
    this.pistonGain.connect(this.masterGain);

    // Single noise source split to both mechanical filters
    this.mechSource = ctx.createBufferSource();
    this.mechSource.buffer = noiseBuffer;
    this.mechSource.loop = true;
    this.mechSource.connect(this.valveFilter);
    this.mechSource.connect(this.pistonFilter);
    this.mechSource.start();

    // --- Compression whoosh chain ---
    this.compFilter = ctx.createBiquadFilter();
    this.compFilter.type = "lowpass";
    this.compFilter.frequency.value = 300;
    this.compFilter.Q.value = 1;

    this.compGain = ctx.createGain();
    this.compGain.gain.value = 0;
    this.compFilter.connect(this.compGain);
    this.compGain.connect(this.masterGain);

    this.compSource = ctx.createBufferSource();
    this.compSource.buffer = noiseBuffer;
    this.compSource.loop = true;
    this.compSource.connect(this.compFilter);
    this.compSource.start();

    // --- Valve click chain ---
    this.valveClickFilter = ctx.createBiquadFilter();
    this.valveClickFilter.type = "bandpass";
    this.valveClickFilter.frequency.value = 5000;
    this.valveClickFilter.Q.value = 5;

    this.valveClickGain = ctx.createGain();
    this.valveClickGain.gain.value = 0;
    this.valveClickFilter.connect(this.valveClickGain);
    this.valveClickGain.connect(this.valveBus!); // Route through valve train bus

    this.valveClickSource = ctx.createBufferSource();
    this.valveClickSource.buffer = noiseBuffer;
    this.valveClickSource.loop = true;
    this.valveClickSource.connect(this.valveClickFilter);
    this.valveClickSource.start();

    // --- Exhaust system ---
    this.exhaustSystem = new ExhaustSystem(ctx, noiseBuffer, defaultExhaustConfig());
    this.exhaustSystem.getOutput().connect(this.masterGain);

    // --- Build channel registry ---
    this._channels = [
      { id: "combustion", label: "Combustion", color: "#ef4444", enabled: true, volume: 1.0, gainNode: this.combustionBus },
      { id: "exhaust",    label: "Exhaust",    color: "#f97316", enabled: true, volume: 1.0, gainNode: this.exhaustSystem.getOutput() },
      { id: "intake",     label: "Intake",     color: "#60a5fa", enabled: true, volume: 1.0, gainNode: this.intakeGain },
      { id: "valve",      label: "Valve Train", color: "#fbbf24", enabled: true, volume: 1.0, gainNode: this.valveBus },
      { id: "piston",     label: "Piston",     color: "#a78bfa", enabled: true, volume: 1.0, gainNode: this.pistonGain },
      { id: "compression", label: "Compression", color: "#38bdf8", enabled: true, volume: 1.0, gainNode: this.compGain },
    ];

    this.initialized = true;
    this.prevCombPerCyl = [];
    this.prevIntakeLift = [];
    this.prevExhaustLift = [];
    console.log("[strepitus] Audio synthesizer initialized");
  }

  private createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = ctx.sampleRate * seconds;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  update(params: SynthParams): void {
    if (!this.ctx || !this.initialized || this._muted) return;

    const t = this.ctx.currentTime;
    const tau = 0.03;
    const rpm = Math.max(params.rpm, 100);
    const baseFreq = Math.max(params.cycle_frequency, 5);
    const cyls = params.cylinders;
    const n = cyls.length;

    // Grow/shrink per-cylinder trackers if cylinder count changed
    while (this.prevCombPerCyl.length < n) this.prevCombPerCyl.push(0);
    if (this.prevCombPerCyl.length > n) this.prevCombPerCyl.length = n;
    while (this.prevIntakeLift.length < n) this.prevIntakeLift.push(0);
    if (this.prevIntakeLift.length > n) this.prevIntakeLift.length = n;
    while (this.prevExhaustLift.length < n) this.prevExhaustLift.push(0);
    if (this.prevExhaustLift.length > n) this.prevExhaustLift.length = n;

    // --- Combustion: per-cylinder firing detection ---
    if (this.channelEnabled("combustion")) {
      const combVol = this.channelVolume("combustion");
      const combThreshold = 0.05;
      const decayTime = Math.max(0.015, 0.08 - (rpm / 6000) * 0.065);
      const noiseDecayTime = decayTime * 0.5;
      const attackTime = 0.002;
      let firingCount = 0;

      for (let c = 0; c < n; c++) {
        const ci = cyls[c].combustion_intensity;
        const prev = this.prevCombPerCyl[c];
        const firing = ci > combThreshold && prev <= combThreshold;
        this.prevCombPerCyl[c] = ci;

        if (firing) {
          const stagger = firingCount * 0.003;
          const fireT = t + stagger;
          const peakGain = Math.min(ci * 0.5, 0.6) / Math.sqrt(n) * combVol;
          const harmGains = [1.0, 0.6, 0.35, 0.2];

          // Oscillator envelopes — use cancelAndHoldAtTime for additive stacking
          for (let i = 0; i < 4; i++) {
            const g = this.combGains[i].gain;
            if (typeof g.cancelAndHoldAtTime === "function") {
              g.cancelAndHoldAtTime(fireT);
            } else {
              g.cancelScheduledValues(fireT);
              g.setValueAtTime(g.value, fireT);
            }
            g.linearRampToValueAtTime(
              g.value + peakGain * harmGains[i],
              fireT + attackTime
            );
            g.exponentialRampToValueAtTime(0.001, fireT + attackTime + decayTime);
          }

          // Noise burst for crackly texture
          const ng = this.combNoiseGain!.gain;
          if (typeof ng.cancelAndHoldAtTime === "function") {
            ng.cancelAndHoldAtTime(fireT);
          } else {
            ng.cancelScheduledValues(fireT);
            ng.setValueAtTime(ng.value, fireT);
          }
          const noisePeak = peakGain * 0.3;
          ng.linearRampToValueAtTime(ng.value + noisePeak, fireT + 0.001);
          ng.exponentialRampToValueAtTime(0.001, fireT + 0.001 + noiseDecayTime);

          firingCount++;
        }
      }
    } else {
      for (let c = 0; c < n; c++) {
        this.prevCombPerCyl[c] = cyls[c].combustion_intensity;
      }
    }

    // Update combustion oscillator frequencies
    const subFreq = Math.max(20, Math.min(40, baseFreq / Math.max(n, 1)));
    const freqMul = [1, 2, 3, 4];
    for (let i = 0; i < 4; i++) {
      this.combOsc[i].frequency.setTargetAtTime(subFreq * freqMul[i], t, tau);
    }

    // --- Intake air rush: max intake_valve_lift across all cylinders ---
    let maxIntake = 0;
    for (let c = 0; c < n; c++) {
      if (cyls[c].intake_valve_lift > maxIntake) maxIntake = cyls[c].intake_valve_lift;
    }
    const intakeVol = this.channelVolume("intake");
    const intakeLevel = this.channelEnabled("intake") ? maxIntake * 0.2 * intakeVol : 0;
    this.intakeGain!.gain.setTargetAtTime(intakeLevel, t, 0.01);

    const intakeCutoff = 800 + (rpm / 6000) * 600;
    this.intakeFilter!.frequency.setTargetAtTime(intakeCutoff, t, tau);

    // --- Mechanical noise ---
    const mechLevel = params.mechanical_noise;

    const valveVol = this.channelVolume("valve");
    const valveLevel = this.channelEnabled("valve") ? mechLevel * 0.12 * valveVol : 0;
    this.valveGain!.gain.setTargetAtTime(valveLevel, t, tau);
    const valveFreq = 3000 + (rpm / 6000) * 1000;
    this.valveFilter!.frequency.setTargetAtTime(valveFreq, t, tau);

    const pistonVol = this.channelVolume("piston");
    const pistonLevel = this.channelEnabled("piston") ? mechLevel * 0.08 * pistonVol : 0;
    this.pistonGain!.gain.setTargetAtTime(pistonLevel, t, tau);
    const pistonFreq = 1000 + (rpm / 6000) * 500;
    this.pistonFilter!.frequency.setTargetAtTime(pistonFreq, t, tau);

    // --- Compression whoosh ---
    if (this.channelEnabled("compression")) {
      const compVol = this.channelVolume("compression");
      let maxCompPressure = 0;
      for (let c = 0; c < n; c++) {
        if (cyls[c].stroke_phase === 1) {
          const p = cyls[c].cylinder_pressure;
          if (p > maxCompPressure) maxCompPressure = p;
        }
      }
      const compRatio = Math.max(0, (maxCompPressure / ATM - 1) / 20);
      const compLevel = Math.min(compRatio * 0.04, 0.04) * compVol;
      this.compGain!.gain.setTargetAtTime(compLevel, t, 0.05);

      const compFreq = 200 + (rpm / 6000) * 200;
      this.compFilter!.frequency.setTargetAtTime(compFreq, t, tau);
    } else {
      this.compGain!.gain.setTargetAtTime(0, t, 0.02);
    }

    // --- Valve clicks ---
    const clickThreshold = 0.0005; // 0.5mm
    let clickCount = 0;
    for (let c = 0; c < n; c++) {
      const il = cyls[c].intake_valve_lift;
      const el = cyls[c].exhaust_valve_lift;
      const pil = this.prevIntakeLift[c];
      const pel = this.prevExhaustLift[c];

      // Detect threshold crossing in either direction
      if ((il > clickThreshold && pil <= clickThreshold) || (il <= clickThreshold && pil > clickThreshold)) {
        clickCount++;
      }
      if ((el > clickThreshold && pel <= clickThreshold) || (el <= clickThreshold && pel > clickThreshold)) {
        clickCount++;
      }

      this.prevIntakeLift[c] = il;
      this.prevExhaustLift[c] = el;
    }

    if (clickCount > 0) {
      const clickGain = (clickCount / Math.sqrt(n)) * 0.06;
      const g = this.valveClickGain!.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(clickGain, t);
      g.exponentialRampToValueAtTime(0.001, t + 0.003);
    }

    // --- Exhaust system ---
    if (this.exhaustSystem && this.channelEnabled("exhaust")) {
      this.exhaustSystem.update(rpm, cyls, this.channelVolume("exhaust"));
    }
  }

  setVolume(volume: number): void {
    this._volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && !this._muted) {
      this.masterGain.gain.setTargetAtTime(this._volume, this.ctx!.currentTime, 0.02);
    }
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        muted ? 0 : this._volume,
        this.ctx!.currentTime,
        0.02
      );
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  get volume(): number {
    return this._volume;
  }

  private channelEnabled(id: string): boolean {
    const ch = this._channels.find((c) => c.id === id);
    return ch ? ch.enabled : true;
  }

  private channelVolume(id: string): number {
    const ch = this._channels.find((c) => c.id === id);
    return ch ? ch.volume : 1.0;
  }

  /** Returns channel info for the mixer UI to auto-render. */
  getChannels(): ChannelInfo[] {
    return this._channels.map(({ id, label, color, enabled, volume }) => ({ id, label, color, enabled, volume }));
  }

  /** Channels whose gainNode is a bus (not modulated in update loop). */
  private static BUS_CHANNELS = new Set(["combustion", "valve", "exhaust"]);

  setChannelEnabled(channel: string, enabled: boolean): void {
    const ch = this._channels.find((c) => c.id === channel);
    if (!ch) return;
    ch.enabled = enabled;
    if (ch.gainNode && this.ctx) {
      if (!enabled) {
        ch.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      } else if (EngineSynthesizer.BUS_CHANNELS.has(channel)) {
        ch.gainNode.gain.setTargetAtTime(ch.volume, this.ctx.currentTime, 0.02);
      }
    }
  }

  setChannelVolume(channel: string, volume: number): void {
    const ch = this._channels.find((c) => c.id === channel);
    if (!ch) return;
    ch.volume = Math.max(0, Math.min(1, volume));
    if (ch.gainNode && this.ctx && ch.enabled) {
      // Bus channels control gain directly; others are modulated as multipliers in update()
      if (EngineSynthesizer.BUS_CHANNELS.has(channel)) {
        ch.gainNode.gain.setTargetAtTime(ch.volume, this.ctx.currentTime, 0.02);
      }
    }
  }

  setExhaustConfig(config: ExhaustSystemConfig): void {
    this.exhaustSystem?.applyConfig(config);
  }

  getExhaustConfig(): ExhaustSystemConfig | null {
    return this.exhaustSystem ? structuredClone(this.exhaustSystem["config"]) : null;
  }

  dispose(): void {
    for (const osc of this.combOsc) osc.stop();
    this.combNoiseSource?.stop();
    this.intakeSource?.stop();
    this.mechSource?.stop();
    this.compSource?.stop();
    this.valveClickSource?.stop();
    this.exhaustSystem?.dispose();
    this.ctx?.close();
    this.combOsc = [];
    this.combGains = [];
    this.exhaustSystem = null;
    this.initialized = false;
  }
}
