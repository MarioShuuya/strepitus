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

/**
 * Exhaust gas color ramp based on temperature and cooling progress.
 * coolingFactor 0 = at exhaust port (white-yellow), 1 = at tip (dim red/gray).
 */
export function exhaustGasColor(tempK: number, coolingFactor: number): THREE.Color {
  const t = Math.max(0, Math.min(1, coolingFactor));
  // Temperature-based brightness: hotter = brighter
  const tempNorm = Math.max(0, Math.min(1, (tempK - 300) / 1200));

  if (t < 0.15) {
    // Port region: white-yellow
    const c = new THREE.Color().lerpColors(
      new THREE.Color(0xffffcc), // warm white
      new THREE.Color(0xffcc44), // bright yellow
      t / 0.15,
    );
    c.multiplyScalar(0.6 + tempNorm * 0.4);
    return c;
  } else if (t < 0.5) {
    // Mid-pipe: yellow → orange
    const sub = (t - 0.15) / 0.35;
    const c = new THREE.Color().lerpColors(
      new THREE.Color(0xffcc44),
      new THREE.Color(0xff6600),
      sub,
    );
    c.multiplyScalar(0.5 + tempNorm * 0.3);
    return c;
  } else {
    // Downstream: orange → dim red/gray
    const sub = (t - 0.5) / 0.5;
    const c = new THREE.Color().lerpColors(
      new THREE.Color(0xff6600),
      new THREE.Color(0x884422),
      sub,
    );
    c.multiplyScalar(0.4 + tempNorm * 0.2);
    return c;
  }
}

/** Pressure-based opacity: higher pressure = more opaque gas visualization. */
export function pressureOpacity(
  pressurePa: number,
  ambientPa: number = 101325
): number {
  const ratio = pressurePa / ambientPa;
  return Math.min(0.1 + (ratio - 1) * 0.02, 0.8);
}
