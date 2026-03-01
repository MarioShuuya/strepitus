/**
 * P-V diagram using Canvas2D.
 * Shows the most recent complete engine cycle.
 * Color-coded by stroke phase.
 */

const PHASE_COLORS = [
  "#60a5fa", // 0 = Intake (blue)
  "#4ade80", // 1 = Compression (green)
  "#ef4444", // 2 = Power (red)
  "#f97316", // 3 = Exhaust (orange)
];

interface PVPoint {
  v: number; // cm³
  p: number; // kPa
  phase: number;
}

const MAX_HISTORY = 5; // keep last N complete cycles

export class PVDiagram {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Points for the cycle currently being recorded */
  private current: PVPoint[] = [];
  /** Ring of completed cycles — newest last */
  private history: PVPoint[][] = [];
  private lastPhase = -1;
  private _visible = true;
  private lastW = 0;
  private lastH = 0;
  private _logScale = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  push(volumeM3: number, pressurePa: number, strokePhase: number): void {
    const pt: PVPoint = {
      v: volumeM3 * 1e6,  // m³ → cm³
      p: pressurePa / 1000, // Pa → kPa
      phase: strokePhase,
    };

    // Detect cycle restart: phase wraps from 3 (exhaust) back to 0 (intake)
    if (this.lastPhase === 3 && strokePhase === 0 && this.current.length > 10) {
      this.history.push(this.current);
      if (this.history.length > MAX_HISTORY) this.history.shift();
      this.current = [];
    }

    this.current.push(pt);
    this.lastPhase = strokePhase;
  }

  get logScale(): boolean { return this._logScale; }
  setLogScale(v: boolean): void { this._logScale = v; }

  render(): void {
    if (!this._visible || this.history.length === 0) return;

    // Match canvas resolution to display size (re-scale on resize)
    const displayW = this.canvas.clientWidth;
    const displayH = this.canvas.clientHeight;
    if (displayW > 0 && (displayW !== this.lastW || displayH !== this.lastH)) {
      this.canvas.width = displayW * 2;
      this.canvas.height = displayH * 2;
      this.ctx.setTransform(2, 0, 0, 2, 0, 0);
      this.lastW = displayW;
      this.lastH = displayH;
    }

    const ctx = this.ctx;
    const w = displayW;
    const h = displayH;
    const pad = { top: 22, right: 12, bottom: 28, left: 52 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = "rgba(10, 10, 10, 1)";
    ctx.fillRect(0, 0, w, h);

    // Compute data range across all stored cycles
    let vMin = Infinity, vMax = -Infinity;
    let pMin = Infinity, pMax = -Infinity;
    for (const cycle of this.history) {
      for (const pt of cycle) {
        if (pt.v < vMin) vMin = pt.v;
        if (pt.v > vMax) vMax = pt.v;
        if (pt.p < pMin) pMin = pt.p;
        if (pt.p > pMax) pMax = pt.p;
      }
    }
    // Ensure minimums > 0 for log scale
    if (vMin < 0.1) vMin = 0.1;
    if (pMin < 1) pMin = 1;

    if (this._logScale) {
      // Log-log: add padding in log space
      const logVMin = Math.log10(vMin);
      const logVMax = Math.log10(vMax);
      const logVPad = (logVMax - logVMin) * 0.06 || 0.1;
      vMin = Math.pow(10, logVMin - logVPad);
      vMax = Math.pow(10, logVMax + logVPad);

      const logPMinR = Math.log10(pMin);
      const logPMaxR = Math.log10(pMax);
      const logPPad = (logPMaxR - logPMinR) * 0.06 || 0.1;
      pMin = Math.pow(10, logPMinR - logPPad);
      pMax = Math.pow(10, logPMaxR + logPPad);
    } else {
      const vPad = (vMax - vMin) * 0.08 || 1;
      vMin -= vPad; vMax += vPad;
      const pPad2 = (pMax - pMin) * 0.08 || 10;
      pMin -= pPad2; pMax += pPad2;
      if (pMin < 0) pMin = 0;
    }

    // Mapping functions
    const logVMin = Math.log10(Math.max(vMin, 0.01));
    const logVMax = Math.log10(Math.max(vMax, 0.02));
    const logVRange = logVMax - logVMin || 1;
    const linVRange = vMax - vMin || 1;

    const logPMin = Math.log10(Math.max(pMin, 0.1));
    const logPMax = Math.log10(Math.max(pMax, 1));
    const logPRange = logPMax - logPMin || 1;
    const linPRange = pMax - pMin || 1;

    const toX = (v: number) => {
      if (this._logScale) {
        const logV = Math.log10(Math.max(v, 0.01));
        return pad.left + ((logV - logVMin) / logVRange) * plotW;
      }
      return pad.left + ((v - vMin) / linVRange) * plotW;
    };
    const toY = (p: number) => {
      if (this._logScale) {
        const logP = Math.log10(Math.max(p, 0.1));
        return pad.top + plotH - ((logP - logPMin) / logPRange) * plotH;
      }
      return pad.top + plotH - ((p - pMin) / linPRange) * plotH;
    };

    // Grid lines
    if (this._logScale) {
      // Log-scale grid: pressure axis (horizontal lines)
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      this.drawLogGrid(ctx, pad, plotW, plotH, pMin, pMax, "horizontal", toY);

      // Log-scale grid: volume axis (vertical lines)
      ctx.textAlign = "center";
      this.drawLogGrid(ctx, pad, plotW, plotH, vMin, vMax, "vertical", toX);
    } else {
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotH * i) / 4;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
      }
      for (let i = 0; i <= 4; i++) {
        const x = pad.left + (plotW * i) / 4;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();
      }
    }

    // Draw cycles — older cycles fainter, newest brightest
    const nCycles = this.history.length;
    for (let ci = 0; ci < nCycles; ci++) {
      const pts = this.history[ci];
      if (pts.length < 2) continue;
      // Opacity: oldest = 0.15, newest = 1.0
      const alpha = nCycles === 1 ? 1.0 : 0.15 + (ci / (nCycles - 1)) * 0.85;
      const lineW = ci === nCycles - 1 ? 2 : 1.2;

      ctx.lineWidth = lineW;
      ctx.globalAlpha = alpha;

      let prevPhase = -1;
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const x = toX(pt.v);
        const y = toY(pt.p);

        if (i === 0 || pt.phase !== prevPhase) {
          if (i > 0) ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = PHASE_COLORS[pt.phase] ?? "#888";
          if (i > 0) {
            const prev = pts[i - 1];
            ctx.moveTo(toX(prev.v), toY(prev.p));
            ctx.lineTo(x, y);
          } else {
            ctx.moveTo(x, y);
          }
        } else {
          ctx.lineTo(x, y);
        }
        prevPhase = pt.phase;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // Axis labels
    ctx.fillStyle = "#666";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    const logTag = this._logScale ? " (log-log)" : "";
    ctx.fillText(`Volume (cm\u00B3)${logTag}`, pad.left + plotW / 2, h - 4);
    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Pressure (kPa)", 0, 0);
    ctx.restore();

    // Axis value labels (linear mode only — log mode draws labels in grid)
    if (!this._logScale) {
      ctx.fillStyle = "#555";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(vMin.toFixed(0), pad.left, pad.top + plotH + 14);
      ctx.fillText(vMax.toFixed(0), pad.left + plotW, pad.top + plotH + 14);
      ctx.textAlign = "right";
      ctx.fillText(pMax.toFixed(0), pad.left - 4, pad.top + 8);
      ctx.fillText(pMin.toFixed(0), pad.left - 4, pad.top + plotH);
    }

    // Legend
    ctx.font = "9px monospace";
    const labels = ["Int", "Comp", "Pwr", "Exh"];
    let lx = pad.left;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = PHASE_COLORS[i];
      ctx.fillText(labels[i], lx + 12, pad.top - 6);
      lx += 42;
    }
  }

  /** Draw log-scale grid lines + labels for one axis. */
  private drawLogGrid(
    ctx: CanvasRenderingContext2D,
    pad: { top: number; right: number; bottom: number; left: number },
    plotW: number, plotH: number,
    dataMin: number, dataMax: number,
    direction: "horizontal" | "vertical",
    toPos: (val: number) => number,
  ): void {
    const logMin = Math.floor(Math.log10(Math.max(dataMin, 0.01)));
    const logMax = Math.ceil(Math.log10(Math.max(dataMax, 0.1)));

    for (let d = logMin; d <= logMax; d++) {
      // Major line at each power of 10
      for (let m = 1; m <= 9; m++) {
        const val = m * Math.pow(10, d);
        if (val < dataMin * 0.8 || val > dataMax * 1.2) continue;
        const pos = toPos(val);
        const isMajor = m === 1;

        if (direction === "horizontal") {
          if (pos < pad.top - 1 || pos > pad.top + plotH + 1) continue;
          ctx.strokeStyle = isMajor ? "#222" : "#181818";
          ctx.lineWidth = isMajor ? 0.5 : 0.3;
          ctx.beginPath();
          ctx.moveTo(pad.left, pos);
          ctx.lineTo(pad.left + plotW, pos);
          ctx.stroke();
          if (isMajor) {
            ctx.fillStyle = "#555";
            const label = val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toFixed(0);
            ctx.textAlign = "right";
            ctx.fillText(label, pad.left - 4, pos + 3);
          }
        } else {
          if (pos < pad.left - 1 || pos > pad.left + plotW + 1) continue;
          ctx.strokeStyle = isMajor ? "#222" : "#181818";
          ctx.lineWidth = isMajor ? 0.5 : 0.3;
          ctx.beginPath();
          ctx.moveTo(pos, pad.top);
          ctx.lineTo(pos, pad.top + plotH);
          ctx.stroke();
          if (isMajor) {
            ctx.fillStyle = "#555";
            ctx.textAlign = "center";
            ctx.fillText(val.toFixed(0), pos, pad.top + plotH + 14);
          }
        }
      }
    }
  }

  setVisible(v: boolean): void {
    this._visible = v;
    this.canvas.style.display = v ? "" : "none";
  }

  get visible(): boolean {
    return this._visible;
  }
}
