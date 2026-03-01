/**
 * Audio Mixer Panel — auto-discovers channels from EngineSynthesizer,
 * provides per-channel volume + enable controls, master volume + mute.
 */

import type { EngineSynthesizer } from "../audio/synthesizer";

export class AudioMixerPanel {
  private el: HTMLElement;
  private synth: EngineSynthesizer;
  private channelList: HTMLElement;
  private masterSlider: HTMLInputElement | null = null;
  private muteBtn: HTMLButtonElement | null = null;
  private _visible = false;
  private knownChannelIds = new Set<string>();

  constructor(containerId: string, synth: EngineSynthesizer) {
    this.el = document.getElementById(containerId)!;
    this.synth = synth;
    this.render();
    this.channelList = this.el.querySelector(".mixer-channels")!;
  }

  get isVisible(): boolean {
    return this._visible;
  }

  toggle(): void {
    this._visible = !this._visible;
    this.el.classList.toggle("hidden", !this._visible);
    if (this._visible) this.refresh();
  }

  /** Re-query channels from synthesizer and update UI. */
  refresh(): void {
    const channels = this.synth.getChannels();
    const newIds = new Set(channels.map((c) => c.id));

    // Add new channels
    for (const ch of channels) {
      if (!this.knownChannelIds.has(ch.id)) {
        this.knownChannelIds.add(ch.id);
        this.channelList.appendChild(this.createChannelRow(ch.id, ch.label, ch.color, ch.enabled, ch.volume));
      }
    }

    // Remove stale channels
    for (const id of this.knownChannelIds) {
      if (!newIds.has(id)) {
        this.knownChannelIds.delete(id);
        const row = this.channelList.querySelector(`[data-channel="${id}"]`);
        if (row) row.remove();
      }
    }

    // Sync master controls
    if (this.masterSlider) {
      this.masterSlider.value = String(Math.round(this.synth.volume * 100));
    }
    if (this.muteBtn) {
      this.muteBtn.textContent = this.synth.muted ? "\u{1F507}" : "\u{1F50A}";
    }
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="mixer-header">
        <span class="mixer-title">Audio Mixer</span>
        <button class="mixer-close" title="Close (A)">\u2715</button>
      </div>
      <div class="mixer-master">
        <button class="mixer-mute-btn" title="Mute">\u{1F50A}</button>
        <label>Master</label>
        <input type="range" class="mixer-master-vol" min="0" max="100" value="30" />
      </div>
      <div class="mixer-channels"></div>
    `;

    this.masterSlider = this.el.querySelector(".mixer-master-vol") as HTMLInputElement;
    this.muteBtn = this.el.querySelector(".mixer-mute-btn") as HTMLButtonElement;

    this.masterSlider.addEventListener("input", () => {
      const vol = parseInt(this.masterSlider!.value, 10) / 100;
      this.synth.setVolume(vol);
      // Also update the control bar volume slider to stay in sync
      const barSlider = document.getElementById("volume-slider") as HTMLInputElement | null;
      if (barSlider) barSlider.value = this.masterSlider!.value;
    });

    this.muteBtn.addEventListener("click", () => {
      this.synth.setMuted(!this.synth.muted);
      this.muteBtn!.textContent = this.synth.muted ? "\u{1F507}" : "\u{1F50A}";
      // Sync control bar mute button
      const barMute = document.getElementById("mute-btn") as HTMLButtonElement | null;
      if (barMute) barMute.textContent = this.synth.muted ? "\u{1F507}" : "\u{1F50A}";
    });

    const closeBtn = this.el.querySelector(".mixer-close") as HTMLButtonElement;
    closeBtn.addEventListener("click", () => this.toggle());
  }

  private createChannelRow(id: string, label: string, color: string, enabled: boolean, volume: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "mixer-channel-row";
    row.dataset.channel = id;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = enabled;
    cb.addEventListener("change", () => {
      this.synth.setChannelEnabled(id, cb.checked);
    });

    const lbl = document.createElement("span");
    lbl.className = "mixer-channel-label";
    lbl.style.color = color;
    lbl.textContent = label;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "mixer-channel-vol";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(volume * 100));
    slider.addEventListener("input", () => {
      this.synth.setChannelVolume(id, parseInt(slider.value, 10) / 100);
    });

    row.appendChild(cb);
    row.appendChild(lbl);
    row.appendChild(slider);
    return row;
  }
}
