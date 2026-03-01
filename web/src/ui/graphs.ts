/**
 * Telemetry display (live values) and historical strip charts.
 * Supports EMA smoothing and per-channel tooltips.
 */

// ── Telemetry (instantaneous values overlay) ──────────────────────

export class TelemetryDisplay {
  private container: HTMLElement;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Element #${containerId} not found`);
    this.container = el;
  }

  update(state: {
    rpm: number;
    cylinder_pressure: number;
    gas_temperature: number;
    stroke_phase: number;
    piston_position: number;
    crank_angle: number;
    power_kw?: number;
    manifold_pressure?: number;
    throttle?: number;
  }): void {
    const phases = ["Intake", "Compression", "Power", "Exhaust"];
    const phase = phases[state.stroke_phase] ?? "Unknown";
    const crankDeg = ((state.crank_angle * 180) / Math.PI) % 720;
    const kw = state.power_kw ?? 0;
    const hp = kw * 1.341;
    const mapKpa = (state.manifold_pressure ?? 101325) / 1000;
    const thr = Math.round((state.throttle ?? 1.0) * 100);

    this.container.innerHTML = `
      <div><span class="label">RPM:</span> <span class="value">${state.rpm.toFixed(0)}</span></div>
      <div><span class="label">Crank:</span> <span class="value">${crankDeg.toFixed(1)}°</span></div>
      <div><span class="label">Phase:</span> <span class="value">${phase}</span></div>
      <div><span class="label">Throttle:</span> <span class="value">${thr}%</span></div>
      <div><span class="label">MAP:</span> <span class="value">${mapKpa.toFixed(1)} kPa</span></div>
      <div><span class="label">Pressure:</span> <span class="value">${(state.cylinder_pressure / 1000).toFixed(1)} kPa</span></div>
      <div><span class="label">Gas Temp:</span> <span class="value">${state.gas_temperature.toFixed(0)} K</span></div>
      <div><span class="label">Piston:</span> <span class="value">${(state.piston_position * 1000).toFixed(1)} mm</span></div>
      <div><span class="label">Power:</span> <span class="value">${kw.toFixed(1)} kW / ${hp.toFixed(1)} HP</span></div>
    `;
  }
}

// ── Chart state passed from main loop ─────────────────────────────

export interface ChartState {
  rpm: number;
  cylinder_pressure: number;
  gas_temperature: number;
  wall_temperature: number;
  torque: number;
  burn_fraction: number;
  cylinder_volume: number;
  crank_angle: number;
  gas_force: number;
  inertia_force: number;
  friction_force: number;
  power_kw: number;
  manifold_pressure: number;
}

// ── Ring buffer for one channel ───────────────────────────────────

const BUFFER_SIZE = 600; // ~10s at 60fps

class RingBuffer {
  readonly values: Float64Array;
  readonly nanFlags: Uint8Array;
  head = 0;
  count = 0;

  constructor() {
    this.values = new Float64Array(BUFFER_SIZE);
    this.nanFlags = new Uint8Array(BUFFER_SIZE);
  }

  push(v: number): void {
    const isNan = !Number.isFinite(v);
    this.nanFlags[this.head] = isNan ? 1 : 0;
    this.values[this.head] = isNan ? 0 : v;
    this.head = (this.head + 1) % BUFFER_SIZE;
    if (this.count < BUFFER_SIZE) this.count++;
  }

  /** Iterate from oldest to newest */
  forEach(fn: (value: number, nanFlag: boolean, index: number) => void): void {
    const start = this.count < BUFFER_SIZE ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % BUFFER_SIZE;
      fn(this.values[idx], this.nanFlags[idx] === 1, i);
    }
  }

  newest(): number {
    if (this.count === 0) return 0;
    const idx = (this.head - 1 + BUFFER_SIZE) % BUFFER_SIZE;
    return this.values[idx];
  }

  minMax(): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    this.forEach((v, nan) => {
      if (nan) return;
      if (v < min) min = v;
      if (v > max) max = v;
    });
    if (!Number.isFinite(min)) return [0, 1];
    if (min === max) return [min - 1, max + 1];
    return [min, max];
  }

}

// ── Chart channel descriptor ─────────────────────────────────────

interface ChartChannel {
  key: keyof ChartState;
  label: string;
  unit: string;
  color: string;
  description: string;
  fixedRange?: [number, number];
  /** Transform raw value for display (e.g. Pa→kPa) */
  displayTransform?: (v: number) => number;
  displayFormat?: (v: number) => string;
}

const CHANNELS: ChartChannel[] = [
  {
    key: "rpm",
    label: "RPM",
    unit: "RPM",
    color: "#4ade80",
    description: "Engine speed — revolutions per minute. Controlled by throttle and load.",
    displayFormat: (v) => v.toFixed(0),
  },
  {
    key: "cylinder_pressure",
    label: "Pressure",
    unit: "kPa",
    color: "#60a5fa",
    description: "Cylinder gas pressure. Peaks during combustion (power stroke), drops on exhaust.",
    displayTransform: (v) => v / 1000,
    displayFormat: (v) => v.toFixed(1),
  },
  {
    key: "gas_temperature",
    label: "Gas Temp",
    unit: "K",
    color: "#f97316",
    description: "In-cylinder gas temperature. Spikes during combustion, cools on expansion.",
    displayFormat: (v) => v.toFixed(0),
  },
  {
    key: "wall_temperature",
    label: "Wall Temp",
    unit: "K",
    color: "#fb923c",
    description: "Cylinder wall temperature. Rises slowly from heat transfer, stabilizes via cooling.",
    fixedRange: [300, 600],
    displayFormat: (v) => v.toFixed(0),
  },
  {
    key: "torque",
    label: "Torque",
    unit: "N·m",
    color: "#a78bfa",
    description: "Instantaneous crankshaft torque. Positive on power stroke, negative during compression.",
    displayFormat: (v) => v.toFixed(2),
  },
  {
    key: "gas_force",
    label: "Gas Force",
    unit: "N",
    color: "#f472b6",
    description: "Force from gas pressure on the piston crown. Proportional to pressure × bore area.",
    displayFormat: (v) => v.toFixed(1),
  },
  {
    key: "inertia_force",
    label: "Inertia Force",
    unit: "N",
    color: "#22d3ee",
    description: "Reciprocating inertia force from piston/rod acceleration. Increases with RPM².",
    displayFormat: (v) => v.toFixed(1),
  },
  {
    key: "friction_force",
    label: "Friction",
    unit: "N",
    color: "#fb7185",
    description: "Piston ring and bearing friction. Always opposes motion, increases with speed.",
    displayFormat: (v) => v.toFixed(1),
  },
  {
    key: "burn_fraction",
    label: "Burn Frac",
    unit: "",
    color: "#fbbf24",
    description: "Mass fraction of fuel burned (Wiebe function). 0 = unburned, 1 = fully combusted.",
    fixedRange: [0, 1],
    displayFormat: (v) => v.toFixed(3),
  },
  {
    key: "cylinder_volume",
    label: "Volume",
    unit: "cm³",
    color: "#38bdf8",
    description: "Instantaneous cylinder volume. Varies sinusoidally with crank angle.",
    displayTransform: (v) => v * 1e6, // m³ → cm³
    displayFormat: (v) => v.toFixed(1),
  },
  {
    key: "power_kw",
    label: "Power",
    unit: "kW",
    color: "#c084fc",
    description: "Instantaneous shaft power (EMA-smoothed torque × RPM). Positive = engine producing work.",
    displayFormat: (v) => v.toFixed(2),
  },
  {
    key: "manifold_pressure",
    label: "MAP",
    unit: "kPa",
    color: "#f59e0b",
    description: "Manifold Absolute Pressure — intake manifold pressure downstream of the throttle. Lower MAP = more throttled, less air entering cylinders.",
    fixedRange: [0, 110],
    displayTransform: (v) => v / 1000,
    displayFormat: (v) => v.toFixed(1),
  },
  {
    key: "crank_angle",
    label: "Crank",
    unit: "°",
    color: "#e879f9",
    description: "Crank angle in degrees (0–720° for a 4-stroke cycle).",
    fixedRange: [0, 720],
    displayTransform: (v) => ((v * 180) / Math.PI) % 720,
    displayFormat: (v) => v.toFixed(1),
  },
];

// ── HistoryCharts ─────────────────────────────────────────────────

const CHART_HEIGHT = 64;
const CHART_PAD_TOP = 13;
const CHART_PAD_BOTTOM = 13;
const RANGE_UPDATE_MS = 5000; // update Y-axis range every 5 seconds

export class HistoryCharts {
  private panel: HTMLElement;
  private healthEl: HTMLDivElement;
  private buffers: Map<string, RingBuffer> = new Map();
  private canvases: Map<string, HTMLCanvasElement> = new Map();
  private valueEls: Map<string, HTMLSpanElement> = new Map();
  private tooltipEls: Map<string, HTMLDivElement> = new Map();
  private lockedRanges: Map<string, [number, number]> = new Map();
  private lastRangeUpdate = 0;
  private visible = true;
  private hadNaN = false;
  private stalled = false;

  constructor(panelId: string) {
    const el = document.getElementById(panelId);
    if (!el) throw new Error(`Element #${panelId} not found`);
    this.panel = el;

    // Health indicator
    this.healthEl = document.createElement("div");
    this.healthEl.className = "health-indicator ok";
    this.healthEl.textContent = "● Engine OK";
    this.panel.appendChild(this.healthEl);

    // Create chart rows
    for (const ch of CHANNELS) {
      const buf = new RingBuffer();
      this.buffers.set(ch.key, buf);

      const row = document.createElement("div");
      row.className = "chart-row";

      const header = document.createElement("div");
      header.className = "chart-header";

      const labelSpan = document.createElement("span");
      labelSpan.className = "chart-label";
      labelSpan.textContent = `${ch.label}${ch.unit ? ` (${ch.unit})` : ""}`;

      // Info icon that toggles description
      const infoBtn = document.createElement("span");
      infoBtn.className = "chart-info-btn";
      infoBtn.textContent = "?";
      infoBtn.title = ch.description;

      const valueSpan = document.createElement("span");
      valueSpan.className = "chart-value";
      valueSpan.textContent = "—";
      this.valueEls.set(ch.key, valueSpan);

      const leftGroup = document.createElement("span");
      leftGroup.className = "chart-label-group";
      leftGroup.appendChild(labelSpan);
      leftGroup.appendChild(infoBtn);

      header.appendChild(leftGroup);
      header.appendChild(valueSpan);

      // Description tooltip (hidden by default)
      const tooltip = document.createElement("div");
      tooltip.className = "chart-tooltip";
      tooltip.textContent = ch.description;
      tooltip.style.display = "none";
      this.tooltipEls.set(ch.key, tooltip);

      infoBtn.addEventListener("click", () => {
        const shown = tooltip.style.display !== "none";
        tooltip.style.display = shown ? "none" : "block";
      });

      const canvas = document.createElement("canvas");
      canvas.width = 520;
      canvas.height = CHART_HEIGHT;
      canvas.style.width = "100%";
      canvas.style.height = `${CHART_HEIGHT}px`;
      canvas.style.display = "block";
      this.canvases.set(ch.key, canvas);

      row.appendChild(header);
      row.appendChild(tooltip);
      row.appendChild(canvas);
      this.panel.appendChild(row);
    }
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle("hidden", !this.visible);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Force recalculation of all Y-axis ranges on next frame. */
  resetRanges(): void {
    this.lockedRanges.clear();
    this.lastRangeUpdate = 0;
  }

  update(state: ChartState): void {
    // Detect NaN before guards may have cleared them
    let anyNaN = false;
    for (const ch of CHANNELS) {
      const raw = state[ch.key];
      if (!Number.isFinite(raw)) anyNaN = true;
      const transformed = ch.displayTransform ? ch.displayTransform(raw) : raw;
      this.buffers.get(ch.key)!.push(transformed);
    }

    if (anyNaN) this.hadNaN = true;
    this.stalled = state.rpm < 1;

    // Update health
    if (this.hadNaN) {
      this.healthEl.className = "health-indicator critical";
      this.healthEl.textContent = "● NaN DETECTED";
    } else if (this.stalled) {
      this.healthEl.className = "health-indicator warn";
      this.healthEl.textContent = "● ENGINE STALLED";
    } else {
      this.healthEl.className = "health-indicator ok";
      this.healthEl.textContent = "● Engine OK";
      this.hadNaN = false; // clear once running clean
    }

    // Periodically refresh locked Y-axis ranges
    const now = performance.now();
    if (now - this.lastRangeUpdate > RANGE_UPDATE_MS) {
      this.refreshRanges();
      this.lastRangeUpdate = now;
    }

    if (!this.visible) return;

    // Render each chart
    for (const ch of CHANNELS) {
      this.renderChart(ch);
    }
  }

  private refreshRanges(): void {
    for (const ch of CHANNELS) {
      if (ch.fixedRange) continue;
      const buf = this.buffers.get(ch.key)!;
      if (buf.count < 2) continue;
      let [yMin, yMax] = buf.minMax();
      const pad = (yMax - yMin) * 0.05 || 1;
      yMin -= pad;
      yMax += pad;
      this.lockedRanges.set(ch.key, [yMin, yMax]);
    }
  }

  private renderChart(ch: ChartChannel): void {
    const canvas = this.canvases.get(ch.key)!;
    const buf = this.buffers.get(ch.key)!;
    const ctx = canvas.getContext("2d")!;

    // Sync canvas resolution to actual display size
    const dw = canvas.clientWidth;
    if (dw > 0 && canvas.width !== dw) {
      canvas.width = dw;
      canvas.height = CHART_HEIGHT;
    }

    const w = canvas.width;
    const h = canvas.height;
    const plotH = h - CHART_PAD_TOP - CHART_PAD_BOTTOM;

    ctx.clearRect(0, 0, w, h);

    if (buf.count < 2) return;

    // Use locked range (updated every 5s) or fixed range
    let [yMin, yMax] = ch.fixedRange
      ?? this.lockedRanges.get(ch.key)
      ?? buf.minMax();

    if (!ch.fixedRange && !this.lockedRanges.has(ch.key)) {
      const pad = (yMax - yMin) * 0.05 || 1;
      yMin -= pad;
      yMax += pad;
    }

    const yRange = yMax - yMin || 1;
    const xStep = w / (BUFFER_SIZE - 1);

    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = ch.color;
    ctx.lineWidth = 1.2;

    let started = false;
    buf.forEach((value, nanFlag, i) => {
      if (nanFlag) {
        const x = i * xStep;
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = "#f87171";
        ctx.lineWidth = 1;
        ctx.moveTo(x, CHART_PAD_TOP);
        ctx.lineTo(x, h - CHART_PAD_BOTTOM);
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 1.2;
        started = false;
        return;
      }

      const x = i * xStep;
      const y = CHART_PAD_TOP + plotH - ((value - yMin) / yRange) * plotH;

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Draw min/max range labels in the padding area
    const fmt = ch.displayFormat ?? ((v: number) => v.toFixed(2));
    ctx.font = "11px monospace";
    ctx.fillStyle = ch.color;
    ctx.textAlign = "left";
    ctx.fillText(fmt(yMax), 4, 11);
    ctx.fillText(fmt(yMin), 4, h - 1);

    // Update current value text
    const current = buf.newest();
    this.valueEls.get(ch.key)!.textContent = fmt(current);
  }
}
