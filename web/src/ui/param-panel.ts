/**
 * Phase 7 — Full parameter panel with grouped sliders for all EngineConfig fields.
 * Includes preset selector, save/load functionality.
 */

import defaultPreset from "../presets/default.json";
import sportPreset from "../presets/sport.json";
import economyPreset from "../presets/economy.json";
import highCompPreset from "../presets/high-comp.json";

interface ParamMeta {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Multiply stored value by this for display (e.g., m → mm) */
  displayScale?: number;
  /** Description shown on hover — explains what the param does and effect of changing it */
  desc?: string;
}

interface ParamGroup {
  title: string;
  params: ParamMeta[];
}

const PARAM_GROUPS: ParamGroup[] = [
  {
    title: "Geometry",
    params: [
      { key: "bore", label: "Bore", min: 0.050, max: 0.130, step: 0.001, unit: "mm", displayScale: 1000,
        desc: "Cylinder diameter. Larger bore = more area for combustion pressure to act on, increasing power. Also increases engine displacement." },
      { key: "stroke", label: "Stroke", min: 0.050, max: 0.130, step: 0.001, unit: "mm", displayScale: 1000,
        desc: "Distance the piston travels. Longer stroke = more displacement and torque but higher piston speeds and friction. Short stroke favors high RPM." },
      { key: "con_rod_length", label: "Con Rod", min: 0.080, max: 0.250, step: 0.001, unit: "mm", displayScale: 1000,
        desc: "Connecting rod length. Longer rod = smoother piston motion and lower side forces, reducing friction. Shorter rod = more aggressive piston acceleration." },
      { key: "compression_ratio", label: "Comp Ratio", min: 6.0, max: 16.0, step: 0.1, unit: ":1",
        desc: "Ratio of max to min cylinder volume. Higher = more thermal efficiency and power, but higher peak pressures and temperatures. Too high causes knock." },
      { key: "throttle_diameter", label: "Throttle Ø", min: 0.025, max: 0.070, step: 0.001, unit: "mm", displayScale: 1000,
        desc: "Throttle body diameter. Larger = more airflow capacity at WOT, more top-end power. Smaller = better low-RPM response and vacuum signal." },
    ],
  },
  {
    title: "Mass / Inertia",
    params: [
      { key: "piston_mass", label: "Piston Mass", min: 0.100, max: 1.000, step: 0.010, unit: "g", displayScale: 1000,
        desc: "Mass of the piston. Heavier piston = larger inertia forces at high RPM, limiting max speed. Lighter piston = higher RPM capability but less structural strength." },
      { key: "con_rod_mass", label: "Con Rod Mass", min: 0.200, max: 1.500, step: 0.010, unit: "g", displayScale: 1000,
        desc: "Mass of the connecting rod. Contributes to reciprocating inertia forces. Heavier = stronger vibrations at high RPM, lighter = smoother high-RPM operation." },
      { key: "crankshaft_inertia", label: "Crank Inertia", min: 0.01, max: 1.0, step: 0.01, unit: "kg\u00B7m\u00B2",
        desc: "Rotational inertia of the crankshaft and flywheel. Higher = smoother RPM (resists speed changes), slower throttle response. Lower = snappy response but rougher idle." },
    ],
  },
  {
    title: "Valve Timing",
    params: [
      { key: "ivo", label: "IVO", min: 0, max: 40, step: 1, unit: "\u00B0",
        desc: "Intake Valve Open — degrees before TDC the intake valve opens. Earlier = more valve overlap with exhaust, better scavenging at high RPM but rougher idle." },
      { key: "ivc", label: "IVC", min: 0, max: 80, step: 1, unit: "\u00B0",
        desc: "Intake Valve Close — degrees after BDC the intake valve closes. Later = more air at high RPM (ram effect) but charge blowback at low RPM, hurting low-end torque." },
      { key: "evo", label: "EVO", min: 0, max: 80, step: 1, unit: "\u00B0",
        desc: "Exhaust Valve Open — degrees before BDC the exhaust valve opens. Earlier = less work extracted from expansion stroke but faster blowdown, better at high RPM." },
      { key: "evc", label: "EVC", min: 0, max: 40, step: 1, unit: "\u00B0",
        desc: "Exhaust Valve Close — degrees after TDC the exhaust valve closes. Later = more overlap with intake, aids scavenging at high RPM but dilutes charge at low RPM." },
      { key: "max_intake_lift", label: "Intake Lift", min: 0.004, max: 0.015, step: 0.001, unit: "mm", displayScale: 1000,
        desc: "Maximum intake valve opening height. More lift = more airflow into the cylinder, increasing power especially at high RPM. Limited by valve-to-piston clearance." },
      { key: "max_exhaust_lift", label: "Exhaust Lift", min: 0.004, max: 0.015, step: 0.001, unit: "mm", displayScale: 1000,
        desc: "Maximum exhaust valve opening height. More lift = faster exhaust gas evacuation, reducing pumping losses. Limited by valve-to-piston clearance." },
    ],
  },
  {
    title: "Combustion",
    params: [
      { key: "afr", label: "AFR", min: 10, max: 20, step: 0.1, unit: ":1",
        desc: "Air-Fuel Ratio. Stoichiometric is ~14.7:1. Richer (lower) = more power, higher temps. Leaner (higher) = better fuel economy but less power, risk of misfire." },
      { key: "fuel_lhv", label: "Fuel LHV", min: 20e6, max: 55e6, step: 1e6, unit: "MJ/kg", displayScale: 1e-6,
        desc: "Lower Heating Value of the fuel — energy per kg. Gasoline ~44 MJ/kg, ethanol ~27 MJ/kg. Higher = more energy released per cycle, more power and heat." },
      { key: "combustion_efficiency", label: "Comb Eff", min: 0.5, max: 1.0, step: 0.01, unit: "",
        desc: "Fraction of fuel energy actually released as heat. 1.0 = perfect combustion. Lower values simulate incomplete burn — less power, lower temperatures." },
      { key: "wiebe_a", label: "Wiebe a", min: 1, max: 10, step: 0.1, unit: "",
        desc: "Wiebe function 'a' parameter — controls completeness of burn. Higher = burn reaches completion sooner in the duration window. Typical value ~5." },
      { key: "wiebe_m", label: "Wiebe m", min: 0.5, max: 5, step: 0.1, unit: "",
        desc: "Wiebe function 'm' parameter — controls burn shape. Lower = faster initial burn (front-loaded). Higher = slower start, more gradual combustion. Typical ~2." },
      { key: "combustion_duration", label: "Comb Duration", min: 20, max: 90, step: 1, unit: "\u00B0",
        desc: "Crank angle over which combustion occurs. Shorter = faster, more violent burn with higher peak pressure. Longer = gentler pressure rise, lower peak loads." },
      { key: "spark_advance", label: "Spark Advance", min: 5, max: 50, step: 1, unit: "\u00B0 BTDC",
        desc: "Ignition timing — degrees before top dead center. More advance = peak pressure earlier, more torque if timed right. Too much = knock. Too little = wasted expansion." },
    ],
  },
  {
    title: "Environment",
    params: [
      { key: "ambient_pressure", label: "Ambient P", min: 80000, max: 110000, step: 1000, unit: "kPa", displayScale: 0.001,
        desc: "Atmospheric pressure. Lower = less air density (simulates altitude), reducing power. Higher = denser charge, more power. Sea level ~101.3 kPa." },
      { key: "ambient_temperature", label: "Ambient T", min: 250, max: 330, step: 1, unit: "K",
        desc: "Intake air temperature. Cooler air (lower) = denser charge, more power. Hotter air (higher) = less dense, reduced power. 293 K = 20\u00B0C." },
    ],
  },
  {
    title: "Friction",
    params: [
      { key: "ring_friction_coefficient", label: "Ring Friction", min: 0.01, max: 0.20, step: 0.01, unit: "",
        desc: "Piston ring friction coefficient. Higher = more friction losses, less net power, more heat generation. Lower = less parasitic loss but potentially less sealing." },
      { key: "viscous_friction", label: "Viscous Friction", min: 10, max: 200, step: 5, unit: "N\u00B7s/m",
        desc: "Speed-dependent viscous damping. Higher = more friction at high RPM (thicker oil). Lower = freer revving but less damping. Scales linearly with piston speed." },
    ],
  },
  {
    title: "Thermal",
    params: [
      { key: "wall_conductivity", label: "Wall Cond", min: 10, max: 100, step: 1, unit: "W/(m\u00B7K)",
        desc: "Cylinder wall thermal conductivity. Higher = more heat lost to coolant, lower gas temperatures, reduced thermal stress but less thermal efficiency." },
      { key: "coolant_temperature", label: "Coolant T", min: 320, max: 400, step: 1, unit: "K",
        desc: "Cooling system temperature. Higher = less heat rejection (walls stay hotter), risk of overheating. Lower = more heat loss, cooler walls. 363 K = 90\u00B0C typical." },
    ],
  },
  {
    title: "Limits",
    params: [
      { key: "max_rpm", label: "Rev Limit", min: 4000, max: 12000, step: 100, unit: "RPM",
        desc: "Maximum engine speed. The rev limiter cuts in at this RPM. Higher = wider powerband but more stress on components. Lower = safer but limits peak power." },
      { key: "idle_load_torque", label: "Idle Load", min: 0, max: 20, step: 0.5, unit: "N\u00B7m",
        desc: "Parasitic load torque from accessories (alternator, A/C, etc.). Higher = engine works harder at idle, needs more throttle to maintain RPM. 0 = no accessories." },
      { key: "dyno_gain", label: "Dyno Gain", min: 0.1, max: 10, step: 0.1, unit: "",
        desc: "Dynamometer feedback gain — how aggressively the dyno holds target RPM. Higher = RPM stays closer to target under load. Lower = more RPM fluctuation." },
      { key: "dyno_integral_gain", label: "Dyno I-Gain", min: 0, max: 5, step: 0.1, unit: "",
        desc: "PI controller integral gain — eliminates steady-state RPM error. Higher = faster convergence but risk of overshoot. 0 = P-only controller." },
      { key: "dyno_load_torque", label: "Dyno Load", min: 0, max: 100, step: 1, unit: "N·m",
        desc: "Constant load torque for load-control dyno mode. Simulates a fixed brake load on the engine." },
    ],
  },
];

const PRESETS: Record<string, Record<string, unknown>> = {
  Default: defaultPreset,
  Sport: sportPreset,
  Economy: economyPreset,
  "High Compression": highCompPreset,
};

const STORAGE_KEY = "strepitus-config";

export class ParamPanel {
  private panel: HTMLElement;
  private sliders: Map<string, HTMLInputElement> = new Map();
  private valueEls: Map<string, HTMLSpanElement> = new Map();
  private presetSelect: HTMLSelectElement | null = null;
  private config: Record<string, number> = {};
  private onChange: (config: Record<string, unknown>) => void;

  constructor(
    panelId: string,
    initialConfig: Record<string, unknown>,
    onChange: (config: Record<string, unknown>) => void
  ) {
    const el = document.getElementById(panelId);
    if (!el) throw new Error(`Element #${panelId} not found`);
    this.panel = el;
    this.onChange = onChange;

    // Copy initial config values
    for (const group of PARAM_GROUPS) {
      for (const p of group.params) {
        this.config[p.key] = (initialConfig[p.key] as number) ?? 0;
      }
    }

    this.buildUI();
  }

  private buildUI(): void {
    // Header
    const header = document.createElement("div");
    header.className = "panel-header";
    header.innerHTML = `<span>Parameters</span><span style="color:#666;font-size:10px">P to toggle</span>`;
    this.panel.appendChild(header);

    // Preset row
    const presetRow = document.createElement("div");
    presetRow.className = "preset-row";

    this.presetSelect = document.createElement("select");
    for (const name of Object.keys(PRESETS)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      this.presetSelect.appendChild(opt);
    }
    this.presetSelect.addEventListener("change", () => {
      const preset = PRESETS[this.presetSelect!.value];
      if (preset) this.applyConfig(preset);
    });

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => this.saveConfig());

    const loadBtn = document.createElement("button");
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", () => this.loadConfig());

    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export";
    exportBtn.addEventListener("click", () => this.exportConfig());

    presetRow.appendChild(this.presetSelect);
    presetRow.appendChild(saveBtn);
    presetRow.appendChild(loadBtn);
    presetRow.appendChild(exportBtn);
    this.panel.appendChild(presetRow);

    // Cylinder layout selector
    const layoutRow = document.createElement("div");
    layoutRow.className = "preset-row";
    const layoutLabel = document.createElement("span");
    layoutLabel.textContent = "Layout: ";
    layoutLabel.style.color = "#888";
    const layoutSelect = document.createElement("select");
    const layouts: Record<string, { count: number; offsets: number[] }> = {
      Single: { count: 1, offsets: [] },
      "Inline-2": { count: 2, offsets: [0, 360] },
      "Inline-4": { count: 4, offsets: [0, 180, 540, 360] },
      "V6": { count: 6, offsets: [0, 120, 240, 360, 480, 600] },
      "V8": { count: 8, offsets: [0, 90, 270, 180, 630, 540, 450, 360] },
    };
    for (const name of Object.keys(layouts)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (layouts[name].count === (this.config["cylinder_count"] ?? 1)) {
        opt.selected = true;
      }
      layoutSelect.appendChild(opt);
    }
    layoutSelect.addEventListener("change", () => {
      const layout = layouts[layoutSelect.value];
      if (layout) {
        this.config["cylinder_count"] = layout.count;
        this.config["crank_offsets_deg"] = layout.offsets as unknown as number;
        this.onChange(this.getConfig());
      }
    });
    layoutRow.appendChild(layoutLabel);
    layoutRow.appendChild(layoutSelect);
    this.panel.appendChild(layoutRow);

    // Parameter groups
    for (const group of PARAM_GROUPS) {
      const groupEl = document.createElement("div");
      groupEl.className = "param-group";

      const title = document.createElement("div");
      title.className = "group-title";
      title.textContent = group.title;
      groupEl.appendChild(title);

      for (const p of group.params) {
        const row = document.createElement("div");
        row.className = "param-row";

        const label = document.createElement("label");
        label.textContent = p.label;
        label.title = p.desc || `${p.key} (${p.unit})`;

        if (p.desc) {
          row.title = p.desc;
        }

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = String(p.min);
        slider.max = String(p.max);
        slider.step = String(p.step);
        slider.value = String(this.config[p.key] ?? p.min);

        const valueSpan = document.createElement("span");
        valueSpan.className = "param-value";

        this.sliders.set(p.key, slider);
        this.valueEls.set(p.key, valueSpan);

        this.updateValueDisplay(p);

        slider.addEventListener("input", () => {
          this.config[p.key] = parseFloat(slider.value);
          this.updateValueDisplay(p);
          this.onChange(this.getConfig());
        });

        row.appendChild(label);
        row.appendChild(slider);
        row.appendChild(valueSpan);
        groupEl.appendChild(row);
      }

      this.panel.appendChild(groupEl);
    }
  }

  private updateValueDisplay(p: ParamMeta): void {
    const raw = this.config[p.key] ?? 0;
    const display = raw * (p.displayScale ?? 1);
    const decimals = p.step < 1 ? (p.step < 0.01 ? 3 : (p.step < 0.1 ? 2 : 1)) : 0;
    const displayDecimals = p.displayScale ? Math.max(0, decimals - Math.log10(p.displayScale || 1)) : decimals;
    const el = this.valueEls.get(p.key);
    if (el) el.textContent = `${display.toFixed(Math.max(0, Math.round(displayDecimals)))}${p.unit ? " " + p.unit : ""}`;
  }

  private getConfig(): Record<string, unknown> {
    return { ...this.config };
  }

  applyConfig(preset: Record<string, unknown>): void {
    for (const group of PARAM_GROUPS) {
      for (const p of group.params) {
        if (p.key in preset) {
          this.config[p.key] = preset[p.key] as number;
          const slider = this.sliders.get(p.key);
          if (slider) slider.value = String(this.config[p.key]);
          this.updateValueDisplay(p);
        }
      }
    }
    this.onChange(this.getConfig());
  }

  private saveConfig(): void {
    const json = JSON.stringify(this.getConfig(), null, 2);
    localStorage.setItem(STORAGE_KEY, json);
    console.log("[strepitus] Config saved to localStorage");
  }

  private loadConfig(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const config = JSON.parse(reader.result as string);
          this.applyConfig(config);
        } catch (e) {
          console.error("[strepitus] Failed to load config:", e);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  private exportConfig(): void {
    const json = JSON.stringify(this.getConfig(), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "strepitus-config.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Try to load saved config from localStorage on startup */
  static loadSaved(): Record<string, unknown> | null {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  toggle(): void {
    this.panel.classList.toggle("hidden");
  }

  get isVisible(): boolean {
    return !this.panel.classList.contains("hidden");
  }
}
