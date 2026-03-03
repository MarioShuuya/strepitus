/**
 * Audio Scope Panel — per-channel scrolling waveform display.
 * Each frame, samples peak amplitude from the AnalyserNode and appends
 * to a circular history buffer, drawn as a scrolling strip chart.
 *
 * Performance: uses ImageData scroll (shift columns left by 1px) so only
 * the newest column is drawn each frame instead of redrawing everything.
 */

import type { EngineSynthesizer } from "../audio/synthesizer";

/** Width of canvas in pixels = number of history samples visible. */
const CANVAS_W = 800;
const CANVAS_H = 100;

interface ScopeChannel {
  id: string;
  label: string;
  color: string;
  analyser: AnalyserNode | null;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dataArray: Uint8Array;
  /** Parsed color components for fast pixel writing. */
  r: number;
  g: number;
  b: number;
}

function parseHexColor(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

export class AudioScopePanel {
  private el: HTMLElement;
  private synth: EngineSynthesizer;
  private channels: ScopeChannel[] = [];
  private _visible = false;
  private rafId: number | null = null;
  private channelContainer: HTMLElement | null = null;


  constructor(containerId: string, synth: EngineSynthesizer) {
    this.el = document.getElementById(containerId)!;
    this.synth = synth;
    this.render();
  }

  get isVisible(): boolean {
    return this._visible;
  }

  toggle(): void {
    this._visible = !this._visible;
    this.el.classList.toggle("hidden", !this._visible);
    if (this._visible) {
      this.refreshChannels();
      this.startLoop();
    } else {
      this.stopLoop();
    }
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="scope-header">
        <span class="scope-title">Audio Scope</span>
        <button class="scope-close" title="Close (O)">\u2715</button>
      </div>
      <div class="scope-channels"></div>
    `;

    const closeBtn = this.el.querySelector(".scope-close") as HTMLButtonElement;
    closeBtn.addEventListener("click", () => this.toggle());

    this.channelContainer = this.el.querySelector(".scope-channels")!;
  }

  private refreshChannels(): void {
    const chData = this.synth.getChannelsWithAnalysers();
    if (!this.channelContainer) return;

    if (this.channels.length !== chData.length) {
      this.channels = [];
      this.channelContainer.innerHTML = "";

      for (const ch of chData) {
        const row = document.createElement("div");
        row.className = "scope-row";

        const lbl = document.createElement("span");
        lbl.className = "scope-label";
        lbl.style.color = ch.color;
        lbl.textContent = ch.label;

        const canvas = document.createElement("canvas");
        canvas.className = "scope-canvas";
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;

        row.appendChild(lbl);
        row.appendChild(canvas);
        this.channelContainer.appendChild(row);

        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        // Pre-fill with background
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const bufferLength = ch.analyser ? ch.analyser.frequencyBinCount : 1024;
        const [r, g, b] = parseHexColor(ch.color);

        this.channels.push({
          id: ch.id,
          label: ch.label,
          color: ch.color,
          analyser: ch.analyser,
          canvas,
          ctx,
          dataArray: new Uint8Array(bufferLength),
          r, g, b,
        });
      }
    } else {
      for (let i = 0; i < chData.length; i++) {
        this.channels[i].analyser = chData[i].analyser;
        if (chData[i].analyser) {
          this.channels[i].dataArray = new Uint8Array(chData[i].analyser!.frequencyBinCount);
        }
      }
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    const draw = () => {
      this.sampleAndDraw();
      this.rafId = requestAnimationFrame(draw);
    };
    this.rafId = requestAnimationFrame(draw);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private sampleAndDraw(): void {
    for (const ch of this.channels) {
      const peak = this.samplePeak(ch);
      this.scrollAndDrawColumn(ch, peak);
    }
  }

  private samplePeak(ch: ScopeChannel): number {
    if (!ch.analyser) return 0;
    ch.analyser.getByteTimeDomainData(ch.dataArray as Uint8Array<ArrayBuffer>);

    let maxDev = 0;
    const data = ch.dataArray;
    const len = data.length;
    // Sample every 4th value for speed (peak detection doesn't need every sample)
    for (let i = 0; i < len; i += 4) {
      const dev = Math.abs(data[i] - 128);
      if (dev > maxDev) maxDev = dev;
    }
    return maxDev / 128;
  }

  /**
   * Shift entire canvas 1px left, then draw the new column on the right edge.
   * Much faster than redrawing the full history every frame.
   */
  private scrollAndDrawColumn(ch: ScopeChannel, peak: number): void {
    const { ctx, r, g, b } = ch;
    const halfH = CANVAS_H / 2;

    // Scroll: copy everything 1px to the left
    const imgData = ctx.getImageData(1, 0, CANVAS_W - 1, CANVAS_H);
    ctx.putImageData(imgData, 0, 0);

    // Clear rightmost column
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(CANVAS_W - 1, 0, 1, CANVAS_H);

    // Center line pixel
    const cx = CANVAS_W - 1;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(cx, halfH, 1, 1);

    // Draw envelope column: filled region + edge pixels
    const extent = Math.round(peak * halfH);
    if (extent > 0) {
      const top = halfH - extent;
      const height = extent * 2;

      // Filled region (semi-transparent)
      ctx.fillStyle = `rgba(${r},${g},${b},0.19)`;
      ctx.fillRect(cx, top, 1, height);

      // Edge pixels (full color)
      ctx.fillStyle = ch.color;
      ctx.fillRect(cx, top, 1, 1);
      ctx.fillRect(cx, halfH + extent - 1, 1, 1);
    }
  }
}
