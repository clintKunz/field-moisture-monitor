import type { SoilPatch } from "../config/farm";
import type { Meters } from "../model/types";
import { distance } from "./geo";

/**
 * Soil water-holding properties, as VWC fractions (0–1).
 * - fieldCapacity: the most water soil holds after free drainage stops.
 * - wiltingPoint: below this, roots can't pull water out and plants wilt.
 * - saturation: every pore full of water.
 */
export interface SoilProps {
  fieldCapacity: number;
  wiltingPoint: number;
  saturation: number;
  /** -1 sandy … 0 loam … +1 clay */
  texture: number;
}

// Typical values for the three textures, linearly blended by `texture`.
const SAND = { fieldCapacity: 0.17, wiltingPoint: 0.07, saturation: 0.38 };
const LOAM = { fieldCapacity: 0.31, wiltingPoint: 0.13, saturation: 0.45 };
const CLAY = { fieldCapacity: 0.4, wiltingPoint: 0.22, saturation: 0.5 };

/** Soil texture at a point: silt loam baseline, pushed sandy or clayey by nearby patches. */
export function soilAt(p: Meters, patches: SoilPatch[]): SoilProps {
  let texture = 0;
  for (const patch of patches) {
    const d = distance(p, patch.center);
    // Gaussian falloff so patch edges blend smoothly into the surrounding soil.
    const w = Math.exp(-((d / patch.radiusM) ** 2) * 1.5);
    texture += patch.texture * w;
  }
  texture = Math.max(-1, Math.min(1, texture));

  const [a, b, f] = texture < 0 ? [LOAM, SAND, -texture] : [LOAM, CLAY, texture];
  const mix = (k: keyof typeof LOAM) => a[k] + (b[k] - a[k]) * f;
  return {
    fieldCapacity: mix("fieldCapacity"),
    wiltingPoint: mix("wiltingPoint"),
    saturation: mix("saturation"),
    texture,
  };
}
