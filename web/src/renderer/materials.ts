/**
 * Heat-reactive material utilities.
 * Maps temperature ranges to colors for visual feedback.
 */

import * as THREE from "three";

/** Temperature color ramp: cold (blue) → warm (orange) → hot (red/white). */
export function temperatureColor(tempK: number): THREE.Color {
  // Clamp to [250, 3000] K range
  const t = Math.max(250, Math.min(3000, tempK));

  // Normalize to [0, 1]
  const norm = (t - 250) / (3000 - 250);

  // HSL ramp: 0.65 (blue) → 0.0 (red), lightness increases with temp
  const hue = 0.65 * (1 - norm);
  const saturation = 0.8;
  const lightness = 0.2 + norm * 0.5;

  return new THREE.Color().setHSL(hue, saturation, lightness);
}

/** Pressure-based opacity: higher pressure = more opaque gas visualization. */
export function pressureOpacity(
  pressurePa: number,
  ambientPa: number = 101325
): number {
  const ratio = pressurePa / ambientPa;
  return Math.min(0.1 + (ratio - 1) * 0.02, 0.8);
}
