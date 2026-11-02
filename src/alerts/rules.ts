import { ALERT_SETTINGS as S } from "../config/alerts";
import { SENSOR_SPACING } from "../config/farm";
import type { MoistureStatus } from "../model/status";
import type { Field, Reading, Sensor } from "../model/types";
import { clusterPoints, describeLocation, extent } from "./cluster";
import type { Finding } from "./types";

/** Everything a rule may look at. Rules read state; they never change it. */
export interface RuleContext {
  now: number;
  fields: readonly Field[];
  sensors: readonly Sensor[];
  view: (sensorId: string) => { status: MoistureStatus; reading: Reading | undefined };
  history: (sensorId: string) => readonly Reading[];
  /** Whether a sensor is already part of an open alert of this kind. Filled in by the engine. */
  alerting?: (kind: Finding["kind"], sensorId: string) => boolean;
}

export type Rule = (ctx: RuleContext) => Finding[];

const HOUR = 3_600_000;

function fieldCenter(field: Field) {
  return field.shape === "circle"
    ? { center: field.center, size: field.radiusM * 2 }
    : { center: { x: (field.min.x + field.max.x) / 2, y: (field.min.y + field.max.y) / 2 }, size: Math.max(field.max.x - field.min.x, field.max.y - field.min.y) };
}

function placeName(field: Field, at: { x: number; y: number }) {
  const { center, size } = fieldCenter(field);
  const where = describeLocation(at, center, size);
  return where === "center" ? `${field.name} center` : `${field.name} ${where}`;
}

/** How long a sensor has stayed above `vwc`, counting back from its latest reading. */
function hoursAbove(history: readonly Reading[], vwc: number): number {
  let i = history.length - 1;
  const last = history[i];
  if (!last || last.vwc <= vwc) return 0;
  while (i > 0 && history[i - 1]!.vwc > vwc) i--;
  return (last.t - history[i]!.t) / HOUR;
}

/**
 * Is this sensor in the problem state? A sensor not yet alerting must cross
 * the threshold; one already alerting stays in until it clears the deadband.
 */
function beyond(ctx: RuleContext, s: Sensor, kind: "dry-spot" | "wet-spot", threshold: number): boolean {
  const { status, reading } = ctx.view(s.id);
  if (status === "offline" || !reading) return false;
  const margin = ctx.alerting?.(kind, s.id) ? S.clearMargin : 0;
  return kind === "dry-spot" ? reading.vwc < threshold + margin : reading.vwc > threshold - margin;
}

/** Dry spots: dry sensors grouped by distance within each field. */
export const drySpots: Rule = (ctx) =>
  ctx.fields.flatMap((field) => {
    const dry = ctx.sensors.filter((s) => s.fieldId === field.id && beyond(ctx, s, "dry-spot", field.thresholds.dry));
    return clusterPoints(dry, SENSOR_SPACING[field.kind] * S.clusterLinkSpacings).map((group) => {
      const lowest = Math.min(...group.map((s) => ctx.view(s.id).reading!.vwc));
      const { center, radiusM } = extent(group.map((s) => s.position));
      const critical = group.length >= S.criticalDrySensors || lowest < field.thresholds.dry - S.criticalDryMargin;
      const fieldWide = group.length >= S.fieldWideShare * ctx.sensors.filter((s) => s.fieldId === field.id).length;
      return {
        kind: "dry-spot" as const,
        fieldId: field.id,
        sensorIds: group.map((s) => s.id),
        severity: critical ? ("critical" as const) : ("warning" as const),
        title: fieldWide ? `Field-wide dry · ${field.name}` : `Dry spot · ${placeName(field, center)}`,
        detail: `${group.length} sensor${group.length > 1 ? "s" : ""}, lowest ${lowest.toFixed(1)}% (crop needs ${field.thresholds.dry}%+)`,
        center,
        radiusM,
      };
    });
  });

/**
 * Wet spots. Saturation right after rain or a pivot pass is normal; staying
 * saturated for many hours points to a leak or overwatering, so duration
 * decides the wording and severity.
 */
export const wetSpots: Rule = (ctx) =>
  ctx.fields.flatMap((field) => {
    const wet = ctx.sensors.filter((s) => s.fieldId === field.id && beyond(ctx, s, "wet-spot", field.thresholds.wet));
    return clusterPoints(wet, SENSOR_SPACING[field.kind] * S.clusterLinkSpacings).map((group) => {
      // Measure duration against the deadband too, so a brief dip between pivot passes doesn't reset the clock.
      const hours = Math.max(...group.map((s) => hoursAbove(ctx.history(s.id), field.thresholds.wet - S.clearMargin)));
      const persistent = hours >= S.leakSuspectHours;
      const { center, radiusM } = extent(group.map((s) => s.position));
      return {
        kind: "wet-spot" as const,
        fieldId: field.id,
        sensorIds: group.map((s) => s.id),
        severity: persistent ? ("critical" as const) : ("warning" as const),
        title: `${persistent ? "Possible leak" : "Saturated"} · ${placeName(field, center)}`,
        detail: `${group.length} sensor${group.length > 1 ? "s" : ""} at or above ${field.thresholds.wet}%, ${hours < 1 ? "just now" : `for ${Math.floor(hours)} h`}`,
        center,
        radiusM,
      };
    });
  });

/** One alert per sensor that has stopped reporting. A flat battery is the usual cause. */
export const offlineSensors: Rule = (ctx) =>
  ctx.sensors
    .filter((s) => ctx.view(s.id).status === "offline" && ctx.history(s.id).length > 0)
    .map((s) => {
      const last = ctx.history(s.id).at(-1)!;
      const field = ctx.fields.find((f) => f.id === s.fieldId)!;
      const cause = last.batteryPct < 5 ? "battery likely dead" : "no signal; check radio or gateway";
      return {
        kind: "offline" as const,
        fieldId: s.fieldId,
        sensorIds: [s.id],
        severity: "warning" as const,
        title: `Sensor offline · ${s.id}`,
        detail: `${field.name}; ${Math.round((ctx.now - last.t) / HOUR)} h since last reading, ${cause}`,
        center: s.position,
        radiusM: 0,
      };
    });

/**
 * Pivot not watering. This rule doesn't peek at the simulator's breakdown
 * schedule. It infers it from the data the way a real system would have to:
 * when a pivot passes over a probe, that probe's moisture jumps. If no probe
 * in the field has jumped for hours, the pivot has probably stopped.
 */
export const pivotIdle: Rule = (ctx) =>
  ctx.fields.flatMap((field) => {
    if (field.shape !== "circle") return [];
    const windowStart = ctx.now - S.pivotIdleHours * HOUR;
    let lastJump = -Infinity;
    let earliest = Infinity;
    for (const s of ctx.sensors) {
      if (s.fieldId !== field.id) continue;
      const h = ctx.history(s.id);
      if (h.length) earliest = Math.min(earliest, h[0]!.t);
      for (let i = h.length - 1; i > 0 && h[i]!.t > lastJump; i--) {
        if (h[i]!.vwc - h[i - 1]!.vwc >= S.irrigationJump) lastJump = Math.max(lastJump, h[i]!.t);
      }
    }
    // Not enough history yet to judge.
    if (earliest > windowStart || lastJump >= windowStart) return [];
    const since = Number.isFinite(lastJump) ? `${Math.floor((ctx.now - lastJump) / HOUR)} h` : `over ${S.pivotIdleHours} h`;
    return [{
      kind: "pivot-idle" as const,
      fieldId: field.id,
      sensorIds: [],
      severity: "critical" as const,
      title: `Pivot not watering · ${field.name}`,
      detail: `No irrigation detected for ${since}. Check the pivot for a breakdown or shutoff.`,
      center: field.center,
      radiusM: field.radiusM,
    }];
  });

export const DEFAULT_RULES: Rule[] = [pivotIdle, drySpots, wetSpots, offlineSensors];
