/**
 * Interactive engine part legend panel.
 * Shows color swatches grouped by category with bidirectional hover highlighting.
 */

import { ENGINE_PARTS, type EnginePart } from "../renderer/engine-view";
import { EXHAUST_PARTS } from "../renderer/exhaust-view";

export class LegendPanel {
  private el: HTMLElement;
  private entries = new Map<string, HTMLElement>();
  private hoverCallback: ((partName: string | null) => void) | null = null;

  constructor(panelId: string) {
    this.el = document.getElementById(panelId)!;
    this.build();
  }

  private build(): void {
    this.el.innerHTML = "";
    this.entries.clear();

    // Header
    const header = document.createElement("div");
    header.className = "legend-header";
    header.innerHTML = `<span>Engine Parts</span><button class="legend-close">\u00d7</button>`;
    header.querySelector(".legend-close")!.addEventListener("click", () => this.toggle());
    this.el.appendChild(header);

    // Group parts by category
    const allParts = [...ENGINE_PARTS, ...EXHAUST_PARTS];
    const groups = new Map<string, EnginePart[]>();
    for (const part of allParts) {
      if (!groups.has(part.category)) groups.set(part.category, []);
      groups.get(part.category)!.push(part);
    }

    for (const [category, parts] of groups) {
      const groupEl = document.createElement("div");
      groupEl.className = "legend-group";

      const titleEl = document.createElement("div");
      titleEl.className = "legend-group-title";
      titleEl.textContent = category;
      groupEl.appendChild(titleEl);

      for (const part of parts) {
        const entry = document.createElement("div");
        entry.className = "legend-entry";

        const swatch = document.createElement("span");
        swatch.className = "legend-swatch";
        swatch.style.backgroundColor = part.color;

        const label = document.createElement("span");
        label.className = "legend-label";
        label.textContent = part.name;

        entry.appendChild(swatch);
        entry.appendChild(label);

        entry.addEventListener("mouseenter", () => {
          if (this.hoverCallback) this.hoverCallback(part.name);
        });
        entry.addEventListener("mouseleave", () => {
          if (this.hoverCallback) this.hoverCallback(null);
        });

        this.entries.set(part.name, entry);
        groupEl.appendChild(entry);
      }

      this.el.appendChild(groupEl);
    }
  }

  /** Register callback fired when legend entry is hovered */
  setPartHoverCallback(cb: (partName: string | null) => void): void {
    this.hoverCallback = cb;
  }

  /** Highlight a legend entry (called when 3D part is hovered) */
  highlightEntry(partName: string | null): void {
    for (const [name, el] of this.entries) {
      if (partName === null) {
        el.classList.remove("legend-highlight", "legend-dim");
      } else if (name === partName) {
        el.classList.add("legend-highlight");
        el.classList.remove("legend-dim");
      } else {
        el.classList.add("legend-dim");
        el.classList.remove("legend-highlight");
      }
    }
  }

  toggle(): void {
    this.el.classList.toggle("hidden");
  }
}
