/**
 * Canvas-based torque/power vs RPM chart for dyno sweep results.
 * Dual Y-axes: torque (left, purple) and power (right, cyan).
 */

import type { SweepDataPoint } from "../dyno/sweep";

const PAD = { top: 30, right: 60, bottom: 35, left: 55 };
const TORQUE_COLOR = "#a78bfa";
const POWER_COLOR = "#22d3ee";

export class DynoChart {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private data: SweepDataPoint[] = [];

  constructor(canvasId: string) {
    const el = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!el) throw new Error(`Element #${canvasId} not found`);
    this.canvas = el;
    this.ctx = el.getContext("2d")!;
  }

  setData(data: SweepDataPoint[]): void {
    this.data = data;
    this.render();
  }

  render(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;

    // Sync resolution
    const dw = canvas.clientWidth;
    const dh = canvas.clientHeight || 280;
    if (dw > 0 && canvas.width !== dw) canvas.width = dw;
    if (dh > 0 && canvas.height !== dh) canvas.height = dh;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (this.data.length < 2) return;

    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;

    // Ranges
    const rpmMin = this.data[0].rpm;
    const rpmMax = this.data[this.data.length - 1].rpm;
    const rpmRange = rpmMax - rpmMin || 1;

    let torqueMax = 0;
    let powerMax = 0;
    let peakTorqueIdx = 0;
    let peakPowerIdx = 0;

    for (let i = 0; i < this.data.length; i++) {
      const d = this.data[i];
      if (d.avgTorque > torqueMax) { torqueMax = d.avgTorque; peakTorqueIdx = i; }
      if (d.powerKw > powerMax) { powerMax = d.powerKw; peakPowerIdx = i; }
    }

    torqueMax = Math.ceil(torqueMax * 1.1) || 1;
    powerMax = Math.ceil(powerMax * 1.1) || 1;

    const xOf = (rpm: number) => PAD.left + ((rpm - rpmMin) / rpmRange) * plotW;
    const yTorque = (t: number) => PAD.top + plotH - (t / torqueMax) * plotH;
    const yPower = (p: number) => PAD.top + plotH - (p / powerMax) * plotH;

    // Grid
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(w - PAD.right, y);
      ctx.stroke();
    }

    // Torque line
    ctx.beginPath();
    ctx.strokeStyle = TORQUE_COLOR;
    ctx.lineWidth = 2;
    for (let i = 0; i < this.data.length; i++) {
      const x = xOf(this.data[i].rpm);
      const y = yTorque(this.data[i].avgTorque);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Power line
    ctx.beginPath();
    ctx.strokeStyle = POWER_COLOR;
    ctx.lineWidth = 2;
    for (let i = 0; i < this.data.length; i++) {
      const x = xOf(this.data[i].rpm);
      const y = yPower(this.data[i].powerKw);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Peak markers
    ctx.font = "11px monospace";

    // Peak torque
    const ptd = this.data[peakTorqueIdx];
    const ptx = xOf(ptd.rpm);
    const pty = yTorque(ptd.avgTorque);
    ctx.fillStyle = TORQUE_COLOR;
    ctx.beginPath();
    ctx.arc(ptx, pty, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(`${ptd.avgTorque.toFixed(1)} N·m @ ${ptd.rpm}`, ptx + 6, pty - 6);

    // Peak power
    const ppd = this.data[peakPowerIdx];
    const ppx = xOf(ppd.rpm);
    const ppy = yPower(ppd.powerKw);
    ctx.fillStyle = POWER_COLOR;
    ctx.beginPath();
    ctx.arc(ppx, ppy, 4, 0, Math.PI * 2);
    ctx.fill();
    const hp = ppd.powerKw * 1.341;
    ctx.fillText(`${ppd.powerKw.toFixed(1)} kW (${hp.toFixed(1)} HP) @ ${ppd.rpm}`, ppx + 6, ppy + 14);

    // Axes labels
    ctx.font = "10px monospace";

    // Left Y (torque)
    ctx.fillStyle = TORQUE_COLOR;
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const v = (torqueMax / 4) * (4 - i);
      ctx.fillText(v.toFixed(0), PAD.left - 4, PAD.top + (plotH / 4) * i + 4);
    }
    ctx.save();
    ctx.translate(12, PAD.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("Torque (N·m)", 0, 0);
    ctx.restore();

    // Right Y (power)
    ctx.fillStyle = POWER_COLOR;
    ctx.textAlign = "left";
    for (let i = 0; i <= 4; i++) {
      const v = (powerMax / 4) * (4 - i);
      ctx.fillText(v.toFixed(1), w - PAD.right + 4, PAD.top + (plotH / 4) * i + 4);
    }
    ctx.save();
    ctx.translate(w - 12, PAD.top + plotH / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("Power (kW)", 0, 0);
    ctx.restore();

    // X axis (RPM)
    ctx.fillStyle = "#888";
    ctx.textAlign = "center";
    const rpmStep = Math.ceil(rpmRange / 6 / 500) * 500;
    for (let r = Math.ceil(rpmMin / rpmStep) * rpmStep; r <= rpmMax; r += rpmStep) {
      const x = xOf(r);
      ctx.fillText(String(r), x, h - PAD.bottom + 14);
    }
    ctx.fillText("RPM", PAD.left + plotW / 2, h - 4);

    // Title
    ctx.fillStyle = "#ccc";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Dyno Curve", w / 2, 16);
  }
}
