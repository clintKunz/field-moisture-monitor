import type { Reading, Thresholds } from "./types";

/**
 * The state a sensor is in, as a grower would describe it. Kept separate from
 * colors and rendering so the alert rules (step 4) can reuse the same logic.
 */
export type MoistureStatus = "dry" | "low" | "ok" | "wet" | "offline";

/** A sensor that hasn't reported for this long is treated as offline. */
export const OFFLINE_AFTER_MS = 60 * 60_000;

export function classify(reading: Reading | undefined, now: number, t: Thresholds): MoistureStatus {
  if (!reading || now - reading.t > OFFLINE_AFTER_MS) return "offline";
  if (reading.vwc < t.dry) return "dry";
  if (reading.vwc > t.wet) return "wet";
  // Between dry and the midpoint of the healthy band: fine for now, watch it.
  if (reading.vwc < (t.dry + t.target) / 2) return "low";
  return "ok";
}

export const STATUS_LABEL: Record<MoistureStatus, string> = {
  dry: "Dry: needs water",
  low: "Drying",
  ok: "In range",
  wet: "Saturated",
  offline: "Offline",
};
