/**
 * Procedural engine sound synthesis via Web Audio API.
 *
 * Per-component acoustic channel model:
 *   Combustion   — pressure-ratio impulse (from Rust, power stroke only)
 *   Exhaust      — blowdown pulse → ExhaustSystem (header/collector/muffler chain)
 *   Intake       — induction pulse → IntakeSystem (runner resonance/plenum/filter chain)
 *   Valve Train  — valve seat impact impulse (closing_speed threshold)
 *   Piston       — conrod side force amplitude (piston_side_force)
 *   Compression  — compression stroke pressure whoosh
 *   Mechanical   — bearing/structural whine (bearing_noise, RPM-scaled)
 */

import { ExhaustSystem } from "./exhaust-system";
import { defaultExhaustConfig, type ExhaustSystemConfig } from "./exhaust-config";
import { IntakeSystem, type CylinderAudioExtended } from "./intake-system";

const ATM = 101325; // atmospheric pressure in Pa

export interface CylinderAudio {
  // ── Existing fields (unchanged) ──
  combustion_intensity: number;    // [0,1] — pressure-ratio from Rust (power stroke only)
  stroke_phase: number;            // 0-3
  intake_valve_lift: number;       // metres
  exhaust_valve_lift: number;      // metres
  burn_fraction: number;           // [0,1]
  cylinder_pressure: number;       // Pa
  exhaust_pulse_intensity: number; // [0,1]
  exhaust_gas_temp: number;        // K
  // ── New physics-derived fields (computed in main.ts) ──
  piston_side_force: number;       // normalized [0,1] — conrod side load
  intake_closing_speed: number;    // m/s — intake valve seat impact
  exhaust_closing_speed: number;   // m/s — exhaust valve seat impact
  intake_pulse: number;            // [0,1] — induction event magnitude
}

export interface SynthParams {
  mechanical_noise: number;   // kept for backward compat
  cycle_frequency: number;
  rpm: number;
  cylinders: CylinderAudio[];
  bearing_noise: number;      // [0,1] RPM-scaled bearing whine
  runner_length_m: number;    // intake runner length in metres
  filter_type: number;        // 0=stock, 1=sport, 2=open
}

/** Compute combustion_intensity from raw cylinder snapshot (used in multi-cyl path). */
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
  analyser: AnalyserNode | null;
}

export class EngineSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Channel registry — auto-discovered by mixer UI
  private _channels: ChannelEntry[] = [];

  // Combustion: 4 oscillators with envelope-triggered firing
  private combOsc: OscillatorNode[] = [];
  private combGains: GainNode[] = [];
  private combustionBus: GainNode | null = null;

  // Combustion noise burst: noise → highpass → gain → combustionBus
  private combNoiseSource: AudioBufferSourceNode | null = null;
  private combNoiseFilter: BiquadFilterNode | null = null;
  private combNoiseGain: GainNode | null = null;

  // Intake system (replaces old broadband intake chain)
  private intakeSystem: IntakeSystem | null = null;

  // Mechanical: shared noise → valve train + piston + bearing chains
  private mechSource: AudioBufferSourceNode | null = null;

  // Valve Train: noise → bandpass → valveGain → valveBus
  private valveFilter: BiquadFilterNode | null = null;
  private valveGain: GainNode | null = null;
  private valveBus: GainNode | null = null;

  // Valve click: noise → bandpass(5kHz) → gain → valveBus
  private valveClickSource: AudioBufferSourceNode | null = null;
  private valveClickFilter: BiquadFilterNode | null = null;
  private valveClickGain: GainNode | null = null;

  // Piston: noise → bandpass → pistonGain → masterGain
  private pistonFilter: BiquadFilterNode | null = null;
  private pistonGain: GainNode | null = null;

  // Compression whoosh: noise → lowpass → compGain → masterGain
  private compSource: AudioBufferSourceNode | null = null;
  private compFilter: BiquadFilterNode | null = null;
  private compGain: GainNode | null = null;

  // Mechanical (bearing whine): noise → highpass → bearingGain → bearingBus
  private bearingSource: AudioBufferSourceNode | null = null;
  private bearingFilter: BiquadFilterNode | null = null;
  private bearingGain: GainNode | null = null;
  private bearingBus: GainNode | null = null;

  // Exhaust system
  private exhaustSystem: ExhaustSystem | null = null;

  // Per-cylinder tracking
  private prevCombPerCyl: number[] = [];
  private prevClickSpeedPerCyl: number[] = [];

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

    // --- Intake system (runner resonance + plenum + air filter) ---
    this.intakeSystem = new IntakeSystem(ctx, noiseBuffer);
    this.intakeSystem.getOutput().connect(this.masterGain);

    // --- Valve Train bus ---
    this.valveBus = ctx.createGain();
    this.valveBus.gain.value = 1.0;
    this.valveBus.connect(this.masterGain);

    // Valve train continuous noise
    this.valveFilter = ctx.createBiquadFilter();
    this.valveFilter.type = "bandpass";
    this.valveFilter.frequency.value = 3500;
    this.valveFilter.Q.value = 3;

    this.valveGain = ctx.createGain();
    this.valveGain.gain.value = 0;
    this.valveFilter.connect(this.valveGain);
    this.valveGain.connect(this.valveBus);

    // Valve click (seat impact impulse)
    this.valveClickFilter = ctx.createBiquadFilter();
    this.valveClickFilter.type = "bandpass";
    this.valveClickFilter.frequency.value = 5000;
    this.valveClickFilter.Q.value = 5;

    this.valveClickGain = ctx.createGain();
    this.valveClickGain.gain.value = 0;
    this.valveClickFilter.connect(this.valveClickGain);
    this.valveClickGain.connect(this.valveBus);

    this.valveClickSource = ctx.createBufferSource();
    this.valveClickSource.buffer = noiseBuffer;
    this.valveClickSource.loop = true;
    this.valveClickSource.connect(this.valveClickFilter);
    this.valveClickSource.start();

    // --- Piston: conrod side force → bandpass ---
    this.pistonFilter = ctx.createBiquadFilter();
    this.pistonFilter.type = "bandpass";
    this.pistonFilter.frequency.value = 1200;
    this.pistonFilter.Q.value = 1.5;

    this.pistonGain = ctx.createGain();
    this.pistonGain.gain.value = 0;
    this.pistonFilter.connect(this.pistonGain);
    this.pistonGain.connect(this.masterGain);

    // Shared mech source feeds valve train + piston filters
    this.mechSource = ctx.createBufferSource();
    this.mechSource.buffer = noiseBuffer;
    this.mechSource.loop = true;
    this.mechSource.connect(this.valveFilter);
    this.mechSource.connect(this.pistonFilter);
    this.mechSource.start();

    // --- Compression whoosh ---
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

    // --- Mechanical (bearing whine): highpass noise, RPM-scaled ---
    this.bearingBus = ctx.createGain();
    this.bearingBus.gain.value = 1.0;
    this.bearingBus.connect(this.masterGain);

    this.bearingFilter = ctx.createBiquadFilter();
    this.bearingFilter.type = "highpass";
    this.bearingFilter.frequency.value = 4000;
    this.bearingFilter.Q.value = 0.7;

    this.bearingGain = ctx.createGain();
    this.bearingGain.gain.value = 0;
    this.bearingFilter.connect(this.bearingGain);
    this.bearingGain.connect(this.bearingBus);

    this.bearingSource = ctx.createBufferSource();
    this.bearingSource.buffer = noiseBuffer;
    this.bearingSource.loop = true;
    this.bearingSource.connect(this.bearingFilter);
    this.bearingSource.start();

    // --- Exhaust system ---
    this.exhaustSystem = new ExhaustSystem(ctx, noiseBuffer, defaultExhaustConfig());
    this.exhaustSystem.getOutput().connect(this.masterGain);

    // --- Build channel registry ---
    this._channels = [
      { id: "combustion",  label: "Combustion",  color: "#ef4444", enabled: true, volume: 1.0, gainNode: this.combustionBus, analyser: null },
      { id: "exhaust",     label: "Exhaust",     color: "#f97316", enabled: true, volume: 1.0, gainNode: this.exhaustSystem.getOutput(), analyser: null },
      { id: "intake",      label: "Intake",      color: "#60a5fa", enabled: true, volume: 1.0, gainNode: this.intakeSystem.getOutput(), analyser: null },
      { id: "valve",       label: "Valve Train", color: "#fbbf24", enabled: true, volume: 1.0, gainNode: this.valveBus, analyser: null },
      { id: "piston",      label: "Piston",      color: "#a78bfa", enabled: true, volume: 1.0, gainNode: this.pistonGain, analyser: null },
      { id: "compression", label: "Compression", color: "#38bdf8", enabled: true, volume: 1.0, gainNode: this.compGain, analyser: null },
      { id: "mechanical",  label: "Mechanical",  color: "#94a3b8", enabled: true, volume: 1.0, gainNode: this.bearingBus, analyser: null },
    ];

    // --- Insert AnalyserNode per channel (between gainNode and masterGain) ---
    for (const ch of this._channels) {
      if (ch.gainNode && this.ctx) {
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0;
        ch.gainNode.disconnect();
        ch.gainNode.connect(analyser);
        analyser.connect(this.masterGain!);
        ch.analyser = analyser;
      }
    }

    this.initialized = true;
    this.prevCombPerCyl = [];
    this.prevClickSpeedPerCyl = [];
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
    const cyls = params.cylinders as CylinderAudioExtended[];
    const n = cyls.length;

    // Grow / shrink per-cylinder trackers
    while (this.prevCombPerCyl.length < n) this.prevCombPerCyl.push(0);
    if (this.prevCombPerCyl.length > n) this.prevCombPerCyl.length = n;
    while (this.prevClickSpeedPerCyl.length < n) this.prevClickSpeedPerCyl.push(0);
    if (this.prevClickSpeedPerCyl.length > n) this.prevClickSpeedPerCyl.length = n;

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

    // --- Intake system: IntakeSystem.update() with runner and filter params ---
    if (this.intakeSystem && this.channelEnabled("intake")) {
      this.intakeSystem.update(
        rpm,
        cyls,
        this.channelVolume("intake"),
        params.runner_length_m,
        params.filter_type,
      );
    }

    // --- Valve Train: closing-speed impulse (seat impact) ---
    if (this.channelEnabled("valve")) {
      const valveVol = this.channelVolume("valve");

      for (let c = 0; c < n; c++) {
        const clickSpeed = Math.max(
          cyls[c].intake_closing_speed ?? 0,
          cyls[c].exhaust_closing_speed ?? 0,
        );
        const prev = this.prevClickSpeedPerCyl[c];

        if (clickSpeed > 0.5 && prev <= 0.5) {
          // Rising edge — seat impact
          const amplitude = Math.min(clickSpeed / 5, 1) * 0.08 * valveVol / Math.sqrt(n);
          const g = this.valveClickGain!.gain;
          g.cancelScheduledValues(t);
          g.setValueAtTime(amplitude, t);
          // Sharp click: 0.1 ms attack already done, 1.5 ms decay
          g.exponentialRampToValueAtTime(0.001, t + 0.0015);
        }
        this.prevClickSpeedPerCyl[c] = clickSpeed;
      }

      // Residual valve train noise (structural resonance) from mechLevel
      const mechLevel = params.mechanical_noise;
      const valveLevel = mechLevel * 0.06 * valveVol;
      this.valveGain!.gain.setTargetAtTime(valveLevel, t, tau);
      const valveFreq = 3000 + (rpm / 6000) * 1000;
      this.valveFilter!.frequency.setTargetAtTime(valveFreq, t, tau);
    } else {
      this.valveGain!.gain.setTargetAtTime(0, t, 0.02);
      this.valveClickGain!.gain.setTargetAtTime(0, t, 0.02);
      for (let c = 0; c < n; c++) {
        this.prevClickSpeedPerCyl[c] = Math.max(
          cyls[c].intake_closing_speed ?? 0,
          cyls[c].exhaust_closing_speed ?? 0,
        );
      }
    }

    // --- Piston: conrod side force amplitude ---
    if (this.channelEnabled("piston")) {
      const pistonVol = this.channelVolume("piston");
      let maxSideForce = 0;
      for (let c = 0; c < n; c++) {
        const sf = cyls[c].piston_side_force ?? 0;
        if (sf > maxSideForce) maxSideForce = sf;
      }
      const pistonLevel = Math.min(maxSideForce * 0.15, 0.12) * pistonVol;
      this.pistonGain!.gain.setTargetAtTime(pistonLevel, t, tau);
      const pistonFreq = 1000 + (rpm / 6000) * 500;
      this.pistonFilter!.frequency.setTargetAtTime(pistonFreq, t, tau);
    } else {
      this.pistonGain!.gain.setTargetAtTime(0, t, 0.02);
    }

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

    // --- Mechanical (bearing whine): bearing_noise scalar ---
    if (this.channelEnabled("mechanical")) {
      const mechVol = this.channelVolume("mechanical");
      const bearingLevel = Math.min(params.bearing_noise, 1) * 0.08 * mechVol;
      this.bearingGain!.gain.setTargetAtTime(bearingLevel, t, tau);
      // Bearing whine frequency rises with RPM
      const bearingFreq = 4000 + (rpm / 8000) * 3000;
      this.bearingFilter!.frequency.setTargetAtTime(bearingFreq, t, tau);
    } else {
      this.bearingGain!.gain.setTargetAtTime(0, t, 0.02);
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

  /** Returns channels with their AnalyserNodes for scope/waveform visualization. */
  getChannelsWithAnalysers(): { id: string; label: string; color: string; analyser: AnalyserNode | null }[] {
    return this._channels.map(({ id, label, color, analyser }) => ({ id, label, color, analyser }));
  }

  /** Bus channels whose gainNode is a bus (restore volume on re-enable, not modulated in update). */
  private static BUS_CHANNELS = new Set(["combustion", "valve", "exhaust", "intake", "mechanical"]);

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
    this.mechSource?.stop();
    this.compSource?.stop();
    this.valveClickSource?.stop();
    this.bearingSource?.stop();
    this.intakeSystem?.dispose();
    this.exhaustSystem?.dispose();
    this.ctx?.close();
    this.combOsc = [];
    this.combGains = [];
    this.intakeSystem = null;
    this.exhaustSystem = null;
    this.initialized = false;
  }
}
