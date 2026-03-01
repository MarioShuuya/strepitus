/**
 * Exhaust Configuration Panel — preset selector + per-component controls.
 * Follows audio-mixer.ts overlay pattern.
 */

import type { EngineSynthesizer } from "../audio/synthesizer";
import {
  type ExhaustSystemConfig,
  type ExhaustPresetName,
  EXHAUST_PRESETS,
  EXHAUST_PRESET_NAMES,
  defaultExhaustConfig,
} from "../audio/exhaust-config";

const STORAGE_KEY = "strepitus-exhaust";

export class ExhaustPanel {
  private el: HTMLElement;
  private synth: EngineSynthesizer;
  private config: ExhaustSystemConfig;
  private _visible = false;
  private onConfigChange: ((config: ExhaustSystemConfig) => void) | null = null;

  constructor(containerId: string, synth: EngineSynthesizer) {
    this.el = document.getElementById(containerId)!;
    this.synth = synth;
    this.config = this.loadFromStorage() || defaultExhaustConfig();
    this.render();
    // Apply loaded config on next tick (synth may not be initialized yet)
    queueMicrotask(() => this.applyConfig());
  }

  /** Register a callback for when exhaust config changes (e.g. to update visuals). */
  setOnConfigChange(cb: (config: ExhaustSystemConfig) => void): void {
    this.onConfigChange = cb;
    // Immediately fire with current config so the visual catches up
    cb(structuredClone(this.config));
  }

  /** Get a copy of the current exhaust config. */
  getConfig(): ExhaustSystemConfig {
    return structuredClone(this.config);
  }

  get isVisible(): boolean {
    return this._visible;
  }

  toggle(): void {
    this._visible = !this._visible;
    this.el.classList.toggle("hidden", !this._visible);
  }

  private applyConfig(): void {
    this.synth.setExhaustConfig(this.config);
    this.saveToStorage();
    this.onConfigChange?.(structuredClone(this.config));
  }

  private render(): void {
    this.el.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.className = "exhaust-header";
    header.innerHTML = `
      <span class="exhaust-title">Exhaust System</span>
      <button class="exhaust-close" title="Close (X)">\u2715</button>
    `;
    this.el.appendChild(header);
    header.querySelector(".exhaust-close")!.addEventListener("click", () => this.toggle());

    // Preset selector
    const presetRow = document.createElement("div");
    presetRow.className = "exhaust-preset-row";
    const select = document.createElement("select");
    select.className = "exhaust-preset-select";
    for (const p of EXHAUST_PRESET_NAMES) {
      const opt = document.createElement("option");
      opt.value = p.value;
      opt.textContent = p.label;
      select.appendChild(opt);
    }
    // Try to detect current preset
    select.value = this.detectPreset() || "stock";
    select.addEventListener("change", () => {
      const name = select.value as ExhaustPresetName;
      this.config = structuredClone(EXHAUST_PRESETS[name]);
      this.applyConfig();
      this.render();
    });
    presetRow.appendChild(select);
    this.el.appendChild(presetRow);

    // Component sections
    this.addHeaderSection();
    this.addCatSection();
    this.addResonatorSection();
    this.addMufflerSection();
    this.addTipSection();
  }

  private detectPreset(): ExhaustPresetName | null {
    for (const p of EXHAUST_PRESET_NAMES) {
      const preset = EXHAUST_PRESETS[p.value];
      if (
        preset.header.enabled === this.config.header.enabled &&
        preset.cat.enabled === this.config.cat.enabled &&
        preset.resonator.enabled === this.config.resonator.enabled &&
        preset.muffler.enabled === this.config.muffler.enabled &&
        preset.muffler.type === this.config.muffler.type
      ) {
        return p.value;
      }
    }
    return null;
  }

  private addComponentSection(
    title: string,
    enabled: boolean,
    onToggle: (v: boolean) => void,
    buildControls: (container: HTMLElement) => void,
  ): void {
    const section = document.createElement("div");
    section.className = "exhaust-section";

    const titleRow = document.createElement("div");
    titleRow.className = "exhaust-section-title";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = enabled;

    const lbl = document.createElement("span");
    lbl.textContent = title;

    titleRow.appendChild(cb);
    titleRow.appendChild(lbl);
    section.appendChild(titleRow);

    const controls = document.createElement("div");
    controls.className = "exhaust-section-controls";
    controls.style.display = enabled ? "block" : "none";
    buildControls(controls);
    section.appendChild(controls);

    cb.addEventListener("change", () => {
      onToggle(cb.checked);
      controls.style.display = cb.checked ? "block" : "none";
      this.applyConfig();
    });

    this.el.appendChild(section);
  }

  private addSlider(
    container: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    unit: string,
    onChange: (v: number) => void,
  ): void {
    const row = document.createElement("div");
    row.className = "exhaust-param-row";

    const lbl = document.createElement("label");
    lbl.textContent = label;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);

    const val = document.createElement("span");
    val.className = "exhaust-param-value";
    val.textContent = `${value}${unit}`;

    slider.addEventListener("input", () => {
      const v = parseFloat(slider.value);
      val.textContent = `${v}${unit}`;
      onChange(v);
      this.applyConfig();
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(val);
    container.appendChild(row);
  }

  private addSelect(
    container: HTMLElement,
    label: string,
    options: { value: string; label: string }[],
    value: string,
    onChange: (v: string) => void,
  ): void {
    const row = document.createElement("div");
    row.className = "exhaust-param-row";

    const lbl = document.createElement("label");
    lbl.textContent = label;

    const select = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      select.appendChild(opt);
    }
    select.value = value;
    select.addEventListener("change", () => {
      onChange(select.value);
      this.applyConfig();
    });

    row.appendChild(lbl);
    row.appendChild(select);
    container.appendChild(row);
  }

  private addHeaderSection(): void {
    this.addComponentSection("Header", this.config.header.enabled, (v) => { this.config.header.enabled = v; }, (c) => {
      this.addSlider(c, "Diameter", 30, 65, 1, this.config.header.diameter, "mm", (v) => { this.config.header.diameter = v; });
      this.addSlider(c, "Length", 200, 900, 10, this.config.header.primaryLength, "mm", (v) => { this.config.header.primaryLength = v; });
      this.addSelect(c, "Collector", [
        { value: "4-1", label: "4-1" },
        { value: "4-2-1", label: "4-2-1" },
        { value: "log", label: "Log" },
      ], this.config.header.collectorType, (v) => { this.config.header.collectorType = v as any; });
    });
  }

  private addCatSection(): void {
    this.addComponentSection("Catalytic Converter", this.config.cat.enabled, (v) => { this.config.cat.enabled = v; }, (c) => {
      this.addSlider(c, "Restriction", 0, 1, 0.05, this.config.cat.flowRestriction, "", (v) => { this.config.cat.flowRestriction = v; });
      this.addSlider(c, "Damping", 0, 1, 0.05, this.config.cat.damping, "", (v) => { this.config.cat.damping = v; });
    });
  }

  private addResonatorSection(): void {
    this.addComponentSection("Resonator", this.config.resonator.enabled, (v) => { this.config.resonator.enabled = v; }, (c) => {
      this.addSlider(c, "Length", 100, 600, 10, this.config.resonator.length, "mm", (v) => { this.config.resonator.length = v; });
      this.addSlider(c, "Diameter", 50, 150, 5, this.config.resonator.diameter, "mm", (v) => { this.config.resonator.diameter = v; });
      this.addSelect(c, "Type", [
        { value: "helmholtz", label: "Helmholtz" },
        { value: "quarter-wave", label: "Quarter Wave" },
      ], this.config.resonator.type, (v) => { this.config.resonator.type = v as any; });
    });
  }

  private addMufflerSection(): void {
    this.addComponentSection("Muffler", this.config.muffler.enabled, (v) => { this.config.muffler.enabled = v; }, (c) => {
      this.addSelect(c, "Type", [
        { value: "chambered", label: "Chambered" },
        { value: "turbo", label: "Turbo" },
        { value: "straight-through", label: "Straight-Through" },
        { value: "none", label: "None" },
      ], this.config.muffler.type, (v) => { this.config.muffler.type = v as any; });
      this.addSlider(c, "Volume", 1, 15, 0.5, this.config.muffler.volume, "L", (v) => { this.config.muffler.volume = v; });
      this.addSlider(c, "Damping", 0, 1, 0.05, this.config.muffler.damping, "", (v) => { this.config.muffler.damping = v; });
      this.addSlider(c, "Outlet \u2300", 30, 100, 1, this.config.muffler.outletDiameter, "mm", (v) => { this.config.muffler.outletDiameter = v; });
    });
  }

  private addTipSection(): void {
    this.addComponentSection("Tip", this.config.tip.enabled, (v) => { this.config.tip.enabled = v; }, (c) => {
      this.addSlider(c, "Diameter", 40, 120, 1, this.config.tip.diameter, "mm", (v) => { this.config.tip.diameter = v; });
      this.addSelect(c, "Type", [
        { value: "single", label: "Single" },
        { value: "dual", label: "Dual" },
        { value: "quad", label: "Quad" },
      ], this.config.tip.type, (v) => { this.config.tip.type = v as any; });
    });
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch { /* quota exceeded or private browsing */ }
  }

  private loadFromStorage(): ExhaustSystemConfig | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* corrupt data */ }
    return null;
  }
}
