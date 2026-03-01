/**
 * Exhaust system audio simulation.
 * Signal chain: oscillators+noise → exhaustBus → header EQ/diameter LP →
 *   collector comb → cat → resonator → muffler → outlet LP → tip HP/comb → output
 *
 * Noise-dominant design: shaped bandpass noise provides tonal body,
 * oscillators add pitch definition at reduced weight.
 * Multi-stage envelope with pre-attack, sustain, and exponential decay.
 */

import type { ExhaustSystemConfig } from "./exhaust-config";
import type { CylinderAudio } from "./synthesizer";

export class ExhaustSystem {
  private ctx: AudioContext;
  private noiseBuffer: AudioBuffer;
  private config: ExhaustSystemConfig;

  // Oscillator sources (3 harmonics) — reduced weight
  private oscillators: OscillatorNode[] = [];
  private oscGains: GainNode[] = [];

  // Broadband noise texture
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;

  // Shaped noise — bandpass-filtered noise for tonal body
  private shapedNoiseSource: AudioBufferSourceNode | null = null;
  private shapedNoiseBP: BiquadFilterNode | null = null;
  private shapedNoiseGain: GainNode | null = null;

  // Merge bus
  private exhaustBus: GainNode | null = null;

  // Filter chain nodes
  private headerFilter: BiquadFilterNode | null = null;
  private headerDiameterLP: BiquadFilterNode | null = null;
  private collectorComb: DelayNode | null = null;
  private collectorCombGain: GainNode | null = null;
  private catFilter: BiquadFilterNode | null = null;
  private catFilter2: BiquadFilterNode | null = null; // second stage for high restriction
  private catGain: GainNode | null = null;
  private resonatorFilter: BiquadFilterNode | null = null;
  private mufflerFilters: BiquadFilterNode[] = [];
  private mufflerGain: GainNode | null = null;
  private outletLP: BiquadFilterNode | null = null;
  private tipFilter: BiquadFilterNode | null = null;
  private tipComb: DelayNode | null = null;
  private tipCombGain: GainNode | null = null;

  // Output
  private outputGain: GainNode;

  // Cached
  private baseFreq = 214;

  constructor(ctx: AudioContext, noiseBuffer: AudioBuffer, config: ExhaustSystemConfig) {
    this.ctx = ctx;
    this.noiseBuffer = noiseBuffer;
    this.config = structuredClone(config);
    this.outputGain = ctx.createGain();
    this.outputGain.gain.value = 1.0;
    this.build();
  }

  private build(): void {
    this.dispose(false);

    const ctx = this.ctx;
    const cfg = this.config;

    // Pipe resonance frequency
    this.baseFreq = 343000 / (4 * cfg.header.primaryLength);

    // --- Exhaust bus ---
    this.exhaustBus = ctx.createGain();
    this.exhaustBus.gain.value = 1.0;

    // --- 3 oscillators (reduced weights) ---
    const types: OscillatorType[] = ["sawtooth", "sawtooth", "sine"];
    const freqMultipliers = [0.5, 1, 2];

    for (let i = 0; i < 3; i++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.exhaustBus);

      const osc = ctx.createOscillator();
      osc.type = types[i];
      osc.frequency.value = this.baseFreq * freqMultipliers[i];
      osc.connect(gain);
      osc.start();

      this.oscillators.push(osc);
      this.oscGains.push(gain);
    }

    // --- Broadband noise ---
    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = this.noiseBuffer;
    this.noiseSource.loop = true;

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;

    this.noiseSource.connect(this.noiseGain);
    this.noiseGain.connect(this.exhaustBus);
    this.noiseSource.start();

    // --- Shaped noise (bandpass at baseFreq for tonal body) ---
    this.shapedNoiseSource = ctx.createBufferSource();
    this.shapedNoiseSource.buffer = this.noiseBuffer;
    this.shapedNoiseSource.loop = true;

    this.shapedNoiseBP = ctx.createBiquadFilter();
    this.shapedNoiseBP.type = "bandpass";
    this.shapedNoiseBP.frequency.value = this.baseFreq;
    this.shapedNoiseBP.Q.value = 2;

    this.shapedNoiseGain = ctx.createGain();
    this.shapedNoiseGain.gain.value = 0;

    this.shapedNoiseSource.connect(this.shapedNoiseBP);
    this.shapedNoiseBP.connect(this.shapedNoiseGain);
    this.shapedNoiseGain.connect(this.exhaustBus);
    this.shapedNoiseSource.start();

    // --- Filter chain ---
    let prevNode: AudioNode = this.exhaustBus;

    // Header — peaking EQ
    this.headerFilter = ctx.createBiquadFilter();
    this.headerFilter.type = "peaking";
    this.headerFilter.frequency.value = this.baseFreq;
    this.headerFilter.Q.value = 1;
    this.headerFilter.gain.value = 6;
    if (cfg.header.enabled) {
      prevNode.connect(this.headerFilter);
      prevNode = this.headerFilter;
    }

    // Header diameter → gentle lowpass
    this.headerDiameterLP = ctx.createBiquadFilter();
    this.headerDiameterLP.type = "lowpass";
    this.headerDiameterLP.frequency.value = 8000 * (cfg.header.diameter / 50);
    this.headerDiameterLP.Q.value = 0.5;
    if (cfg.header.enabled) {
      prevNode.connect(this.headerDiameterLP);
      prevNode = this.headerDiameterLP;
    }

    // Collector type → comb filter effects
    if (cfg.header.enabled && cfg.header.collectorType !== "4-1") {
      // "4-2-1" → comb at half-fundamental; "log" → gentler comb
      const combDelay = cfg.header.collectorType === "4-2-1"
        ? 1 / (this.baseFreq * 0.5) // half-fundamental
        : 1 / (this.baseFreq * 0.3); // gentler
      const clampedDelay = Math.min(Math.max(combDelay, 0.0002), 0.02);

      this.collectorComb = ctx.createDelay(0.05);
      this.collectorComb.delayTime.value = clampedDelay;

      this.collectorCombGain = ctx.createGain();
      this.collectorCombGain.gain.value = cfg.header.collectorType === "4-2-1" ? 0.3 : 0.15;

      // Feedforward comb: original + delayed*gain
      const combMerge = ctx.createGain();
      combMerge.gain.value = 1.0;
      prevNode.connect(combMerge);
      prevNode.connect(this.collectorComb);
      this.collectorComb.connect(this.collectorCombGain);
      this.collectorCombGain.connect(combMerge);
      prevNode = combMerge;
    }

    // Cat — widened cutoff range + optional second stage
    this.catFilter = ctx.createBiquadFilter();
    this.catFilter.type = "lowpass";
    const catCutoff = Math.max(200, Math.min(4500, 4500 * (1 - cfg.cat.flowRestriction * 1.5)));
    this.catFilter.frequency.value = catCutoff;
    this.catFilter.Q.value = 0.7;
    this.catGain = ctx.createGain();
    this.catGain.gain.value = (1 - cfg.cat.damping * 0.4);
    if (cfg.cat.enabled) {
      prevNode.connect(this.catFilter);
      this.catFilter.connect(this.catGain);
      prevNode = this.catGain;

      // Second lowpass stage for high restriction
      if (cfg.cat.flowRestriction > 0.5) {
        this.catFilter2 = ctx.createBiquadFilter();
        this.catFilter2.type = "lowpass";
        this.catFilter2.frequency.value = catCutoff * 1.2;
        this.catFilter2.Q.value = 0.5;
        prevNode.connect(this.catFilter2);
        prevNode = this.catFilter2;
      }
    }

    // Resonator — deeper notch, diameter affects Q
    this.resonatorFilter = ctx.createBiquadFilter();
    this.resonatorFilter.type = "notch";
    this.resonatorFilter.frequency.value = 343000 / (4 * cfg.resonator.length);
    const baseResQ = cfg.resonator.type === "helmholtz" ? 12 : 8;
    this.resonatorFilter.Q.value = baseResQ * (60 / Math.max(cfg.resonator.diameter, 30));
    if (cfg.resonator.enabled) {
      prevNode.connect(this.resonatorFilter);
      prevNode = this.resonatorFilter;
    }

    // Muffler — significantly differentiated by type
    this.mufflerFilters = [];
    this.mufflerGain = null;
    if (cfg.muffler.enabled && cfg.muffler.type !== "none") {
      switch (cfg.muffler.type) {
        case "chambered": {
          // Lower base freq for large volumes, peaking resonance for "boxy" sound
          const freq = Math.max(800, 1200 / Math.sqrt(Math.max(cfg.muffler.volume, 0.5)));
          for (let i = 0; i < 2; i++) {
            const f = ctx.createBiquadFilter();
            f.type = "lowpass";
            f.frequency.value = freq * (i === 0 ? 1.0 : 1.5);
            f.Q.value = 0.7 + cfg.muffler.damping * 0.5;
            this.mufflerFilters.push(f);
            prevNode.connect(f);
            prevNode = f;
          }
          // Peaking resonance for "boxy" character
          const peak = ctx.createBiquadFilter();
          peak.type = "peaking";
          peak.frequency.value = freq * 0.8;
          peak.Q.value = 3;
          peak.gain.value = 4;
          this.mufflerFilters.push(peak);
          prevNode.connect(peak);
          prevNode = peak;
          break;
        }
        case "turbo": {
          // Lowpass + bandpass at 400-600Hz for swirl resonance
          const f = ctx.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.value = 2800 / Math.sqrt(Math.max(cfg.muffler.volume, 0.5));
          f.Q.value = 0.7;
          this.mufflerFilters.push(f);
          prevNode.connect(f);
          prevNode = f;

          const swirl = ctx.createBiquadFilter();
          swirl.type = "bandpass";
          swirl.frequency.value = 500;
          swirl.Q.value = 1.5;
          // Parallel mix: merge original + swirl-filtered
          const swirlMerge = ctx.createGain();
          swirlMerge.gain.value = 1.0;
          prevNode.connect(swirlMerge);
          const swirlGain = ctx.createGain();
          swirlGain.gain.value = 0.4;
          prevNode.connect(swirl);
          swirl.connect(swirlGain);
          swirlGain.connect(swirlMerge);
          this.mufflerFilters.push(swirl);
          prevNode = swirlMerge;
          break;
        }
        case "straight-through": {
          // Barely muffled — high cutoff, low Q
          const f = ctx.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.value = 6000;
          f.Q.value = 0.3;
          this.mufflerFilters.push(f);
          prevNode.connect(f);
          prevNode = f;
          break;
        }
      }

      // Muffler damping → gain reduction
      this.mufflerGain = ctx.createGain();
      this.mufflerGain.gain.value = 1 - cfg.muffler.damping * 0.4;
      prevNode.connect(this.mufflerGain);
      prevNode = this.mufflerGain;
    }

    // Muffler outlet diameter → lowpass
    if (cfg.muffler.enabled && cfg.muffler.type !== "none") {
      this.outletLP = ctx.createBiquadFilter();
      this.outletLP.type = "lowpass";
      this.outletLP.frequency.value = 2000 * (cfg.muffler.outletDiameter / 50);
      this.outletLP.Q.value = 0.5;
      prevNode.connect(this.outletLP);
      prevNode = this.outletLP;
    }

    // Tip — highpass + type-specific comb/delay
    this.tipFilter = ctx.createBiquadFilter();
    this.tipFilter.type = "highpass";
    this.tipFilter.frequency.value = 80 / (cfg.tip.diameter / 50);
    this.tipFilter.Q.value = 0.5;
    if (cfg.tip.enabled) {
      prevNode.connect(this.tipFilter);
      prevNode = this.tipFilter;
    }

    // Tip type effects
    if (cfg.tip.enabled && cfg.tip.type !== "single") {
      const delayMs = cfg.tip.type === "quad" ? 0.001 : 0.0005; // 1ms or 0.5ms
      this.tipComb = ctx.createDelay(0.01);
      this.tipComb.delayTime.value = delayMs;

      this.tipCombGain = ctx.createGain();
      this.tipCombGain.gain.value = cfg.tip.type === "quad" ? 0.25 : 0.2;

      const tipMerge = ctx.createGain();
      tipMerge.gain.value = 1.0;
      prevNode.connect(tipMerge);
      prevNode.connect(this.tipComb);
      this.tipComb.connect(this.tipCombGain);
      this.tipCombGain.connect(tipMerge);
      prevNode = tipMerge;
    }

    // Final → output
    prevNode.connect(this.outputGain);
  }

  applyConfig(config: ExhaustSystemConfig): void {
    const needsRebuild =
      config.cat.enabled !== this.config.cat.enabled ||
      config.resonator.enabled !== this.config.resonator.enabled ||
      config.muffler.enabled !== this.config.muffler.enabled ||
      config.muffler.type !== this.config.muffler.type ||
      config.header.enabled !== this.config.header.enabled ||
      config.header.collectorType !== this.config.header.collectorType ||
      config.tip.enabled !== this.config.tip.enabled ||
      config.tip.type !== this.config.tip.type;

    this.config = structuredClone(config);

    if (needsRebuild) {
      this.build();
      return;
    }

    // Live-update filter params
    const t = this.ctx.currentTime;
    const tau = 0.05;

    // Oscillator frequencies
    const newBaseFreq = 343000 / (4 * config.header.primaryLength);
    if (Math.abs(newBaseFreq - this.baseFreq) > 1) {
      this.baseFreq = newBaseFreq;
      const freqMul = [0.5, 1, 2];
      for (let i = 0; i < this.oscillators.length; i++) {
        this.oscillators[i].frequency.setTargetAtTime(this.baseFreq * freqMul[i], t, tau);
      }
      // Update shaped noise bandpass
      if (this.shapedNoiseBP) {
        this.shapedNoiseBP.frequency.setTargetAtTime(this.baseFreq, t, tau);
      }
    }

    if (this.headerFilter) {
      this.headerFilter.frequency.setTargetAtTime(this.baseFreq, t, tau);
    }

    if (this.headerDiameterLP) {
      this.headerDiameterLP.frequency.setTargetAtTime(8000 * (config.header.diameter / 50), t, tau);
    }

    if (this.catFilter && this.catGain) {
      const catCutoff = Math.max(200, Math.min(4500, 4500 * (1 - config.cat.flowRestriction * 1.5)));
      this.catFilter.frequency.setTargetAtTime(catCutoff, t, tau);
      this.catGain.gain.setTargetAtTime(1 - config.cat.damping * 0.4, t, tau);
    }

    if (this.resonatorFilter) {
      this.resonatorFilter.frequency.setTargetAtTime(343000 / (4 * config.resonator.length), t, tau);
      const baseResQ = config.resonator.type === "helmholtz" ? 12 : 8;
      this.resonatorFilter.Q.setTargetAtTime(baseResQ * (60 / Math.max(config.resonator.diameter, 30)), t, tau);
    }

    if (this.mufflerGain) {
      this.mufflerGain.gain.setTargetAtTime(1 - config.muffler.damping * 0.4, t, tau);
    }

    if (this.outletLP) {
      this.outletLP.frequency.setTargetAtTime(2000 * (config.muffler.outletDiameter / 50), t, tau);
    }

    if (this.tipFilter) {
      this.tipFilter.frequency.setTargetAtTime(80 / (config.tip.diameter / 50), t, tau);
    }
  }

  update(rpm: number, cylinders: CylinderAudio[], channelVolume = 1.0): void {
    if (!this.exhaustBus || this.oscGains.length === 0) return;
    const t = this.ctx.currentTime;
    const n = cylinders.length;

    const threshold = 0.02;

    // Reduced oscillator weights (noise-dominant)
    const harmWeights = [0.3, 0.4, 0.15];

    for (let c = 0; c < n; c++) {
      const intensity = cylinders[c].exhaust_pulse_intensity;
      const firing = intensity > threshold;

      if (firing) {
        // No artificial stagger — trust physics timing
        const fireT = t;
        const peakGain = intensity * 0.6 / Math.sqrt(n) * channelVolume;

        // Multi-stage envelope
        const preAttack = 0.0002;  // 0.2ms → 30%
        const mainAttack = 0.0008; // 0.8ms → 100%
        const sustainTime = Math.max(0.002, 0.008 - (rpm / 8000) * 0.006); // 2-8ms
        const decayTime = Math.max(0.010, 0.050 - (rpm / 6000) * 0.040);   // 10-50ms

        // Oscillator envelopes
        for (let i = 0; i < 3; i++) {
          const g = this.oscGains[i].gain;
          if (typeof g.cancelAndHoldAtTime === "function") {
            g.cancelAndHoldAtTime(fireT);
          } else {
            g.cancelScheduledValues(fireT);
            g.setValueAtTime(g.value, fireT);
          }
          const peak = peakGain * harmWeights[i];
          // Pre-attack → main attack → sustain → decay
          g.linearRampToValueAtTime(g.value + peak * 0.3, fireT + preAttack);
          g.linearRampToValueAtTime(g.value + peak, fireT + preAttack + mainAttack);
          g.linearRampToValueAtTime(g.value + peak * 0.6, fireT + preAttack + mainAttack + sustainTime);
          g.exponentialRampToValueAtTime(0.001, fireT + preAttack + mainAttack + sustainTime + decayTime);
        }

        // Broadband noise burst — 120% of oscillator peak
        const ng = this.noiseGain!.gain;
        if (typeof ng.cancelAndHoldAtTime === "function") {
          ng.cancelAndHoldAtTime(fireT);
        } else {
          ng.cancelScheduledValues(fireT);
          ng.setValueAtTime(ng.value, fireT);
        }
        const noisePeak = peakGain * 1.2;
        ng.linearRampToValueAtTime(ng.value + noisePeak * 0.3, fireT + preAttack);
        ng.linearRampToValueAtTime(ng.value + noisePeak, fireT + preAttack + mainAttack);
        ng.linearRampToValueAtTime(ng.value + noisePeak * 0.6, fireT + preAttack + mainAttack + sustainTime);
        ng.exponentialRampToValueAtTime(0.001, fireT + preAttack + mainAttack + sustainTime + decayTime * 0.7);

        // Shaped noise envelope — same multi-stage
        const sg = this.shapedNoiseGain!.gain;
        if (typeof sg.cancelAndHoldAtTime === "function") {
          sg.cancelAndHoldAtTime(fireT);
        } else {
          sg.cancelScheduledValues(fireT);
          sg.setValueAtTime(sg.value, fireT);
        }
        const shapedPeak = peakGain * 0.8;
        sg.linearRampToValueAtTime(sg.value + shapedPeak * 0.3, fireT + preAttack);
        sg.linearRampToValueAtTime(sg.value + shapedPeak, fireT + preAttack + mainAttack);
        sg.linearRampToValueAtTime(sg.value + shapedPeak * 0.6, fireT + preAttack + mainAttack + sustainTime);
        sg.exponentialRampToValueAtTime(0.001, fireT + preAttack + mainAttack + sustainTime + decayTime * 0.8);
      }
    }

    // Temperature-shift header peaking EQ frequency
    if (this.headerFilter && this.config.header.enabled) {
      let maxTemp = 300;
      for (let c = 0; c < n; c++) {
        if (cylinders[c].exhaust_gas_temp > maxTemp) {
          maxTemp = cylinders[c].exhaust_gas_temp;
        }
      }
      const tempShiftedFreq = this.baseFreq * Math.sqrt(maxTemp / 300);
      this.headerFilter.frequency.setTargetAtTime(tempShiftedFreq, t, 0.1);
    }
  }

  getOutput(): GainNode {
    return this.outputGain;
  }

  dispose(disconnectOutput = true): void {
    for (const osc of this.oscillators) {
      try { osc.stop(); } catch { /* already stopped */ }
      osc.disconnect();
    }
    for (const g of this.oscGains) g.disconnect();
    this.oscillators = [];
    this.oscGains = [];

    try { this.noiseSource?.stop(); } catch { /* already stopped */ }
    this.noiseSource?.disconnect();
    this.noiseGain?.disconnect();

    try { this.shapedNoiseSource?.stop(); } catch { /* already stopped */ }
    this.shapedNoiseSource?.disconnect();
    this.shapedNoiseBP?.disconnect();
    this.shapedNoiseGain?.disconnect();

    this.exhaustBus?.disconnect();
    this.headerFilter?.disconnect();
    this.headerDiameterLP?.disconnect();
    this.collectorComb?.disconnect();
    this.collectorCombGain?.disconnect();
    this.catFilter?.disconnect();
    this.catFilter2?.disconnect();
    this.catGain?.disconnect();
    this.resonatorFilter?.disconnect();
    for (const f of this.mufflerFilters) f.disconnect();
    this.mufflerGain?.disconnect();
    this.outletLP?.disconnect();
    this.tipFilter?.disconnect();
    this.tipComb?.disconnect();
    this.tipCombGain?.disconnect();

    if (disconnectOutput) {
      this.outputGain.disconnect();
    }

    this.noiseSource = null;
    this.noiseGain = null;
    this.shapedNoiseSource = null;
    this.shapedNoiseBP = null;
    this.shapedNoiseGain = null;
    this.exhaustBus = null;
    this.headerDiameterLP = null;
    this.collectorComb = null;
    this.collectorCombGain = null;
    this.catFilter2 = null;
    this.mufflerFilters = [];
    this.mufflerGain = null;
    this.outletLP = null;
    this.tipComb = null;
    this.tipCombGain = null;
  }
}
