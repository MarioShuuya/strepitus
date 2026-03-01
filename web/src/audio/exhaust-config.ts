/**
 * Exhaust system configuration types and presets.
 * Each exhaust component maps to a Web Audio filter stage.
 */

export type CollectorType = "4-1" | "4-2-1" | "log";
export type ResonatorType = "helmholtz" | "quarter-wave";
export type MufflerType = "chambered" | "turbo" | "straight-through" | "none";
export type TipType = "single" | "dual" | "quad";

export interface HeaderConfig {
  enabled: boolean;
  diameter: number;       // mm
  primaryLength: number;  // mm
  collectorType: CollectorType;
}

export interface CatConfig {
  enabled: boolean;
  flowRestriction: number; // 0-1
  damping: number;         // 0-1
}

export interface ResonatorConfig {
  enabled: boolean;
  length: number;          // mm
  diameter: number;        // mm
  type: ResonatorType;
}

export interface MufflerConfig {
  enabled: boolean;
  type: MufflerType;
  volume: number;          // liters
  damping: number;         // 0-1
  outletDiameter: number;  // mm
}

export interface TipConfig {
  enabled: boolean;
  diameter: number;        // mm
  type: TipType;
}

export interface ExhaustSystemConfig {
  header: HeaderConfig;
  cat: CatConfig;
  resonator: ResonatorConfig;
  muffler: MufflerConfig;
  tip: TipConfig;
}

export type ExhaustPresetName = "stock" | "sport" | "straight-pipe" | "track" | "touring";

export const EXHAUST_PRESETS: Record<ExhaustPresetName, ExhaustSystemConfig> = {
  stock: {
    header:    { enabled: true, diameter: 38, primaryLength: 400, collectorType: "log" },
    cat:       { enabled: true, flowRestriction: 0.4, damping: 0.5 },
    resonator: { enabled: true, length: 300, diameter: 80, type: "quarter-wave" },
    muffler:   { enabled: true, type: "chambered", volume: 8, damping: 0.7, outletDiameter: 50 },
    tip:       { enabled: true, diameter: 60, type: "single" },
  },
  sport: {
    header:    { enabled: true, diameter: 45, primaryLength: 500, collectorType: "4-2-1" },
    cat:       { enabled: true, flowRestriction: 0.15, damping: 0.2 },
    resonator: { enabled: true, length: 250, diameter: 100, type: "helmholtz" },
    muffler:   { enabled: true, type: "straight-through", volume: 5, damping: 0.3, outletDiameter: 76 },
    tip:       { enabled: true, diameter: 80, type: "dual" },
  },
  "straight-pipe": {
    header:    { enabled: true, diameter: 50, primaryLength: 600, collectorType: "4-1" },
    cat:       { enabled: false, flowRestriction: 0, damping: 0 },
    resonator: { enabled: false, length: 200, diameter: 80, type: "quarter-wave" },
    muffler:   { enabled: false, type: "none", volume: 0, damping: 0, outletDiameter: 76 },
    tip:       { enabled: true, diameter: 76, type: "single" },
  },
  track: {
    header:    { enabled: true, diameter: 50, primaryLength: 700, collectorType: "4-1" },
    cat:       { enabled: false, flowRestriction: 0, damping: 0 },
    resonator: { enabled: false, length: 200, diameter: 80, type: "quarter-wave" },
    muffler:   { enabled: false, type: "none", volume: 0, damping: 0, outletDiameter: 80 },
    tip:       { enabled: true, diameter: 90, type: "quad" },
  },
  touring: {
    header:    { enabled: true, diameter: 42, primaryLength: 450, collectorType: "4-2-1" },
    cat:       { enabled: true, flowRestriction: 0.3, damping: 0.4 },
    resonator: { enabled: true, length: 350, diameter: 90, type: "quarter-wave" },
    muffler:   { enabled: true, type: "turbo", volume: 10, damping: 0.5, outletDiameter: 60 },
    tip:       { enabled: true, diameter: 65, type: "dual" },
  },
};

export const EXHAUST_PRESET_NAMES: { value: ExhaustPresetName; label: string }[] = [
  { value: "stock", label: "Stock" },
  { value: "sport", label: "Sport" },
  { value: "straight-pipe", label: "Straight Pipe" },
  { value: "track", label: "Track" },
  { value: "touring", label: "Touring" },
];

export function defaultExhaustConfig(): ExhaustSystemConfig {
  return structuredClone(EXHAUST_PRESETS.stock);
}
