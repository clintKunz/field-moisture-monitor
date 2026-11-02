import type { Meters } from "../model/types";

export type AlertKind = "dry-spot" | "wet-spot" | "offline" | "pivot-idle";
export type Severity = "critical" | "warning";

/**
 * A rule's raw result for one evaluation: "these sensors in this field
 * look like a dry spot right now". Findings are stateless; the engine turns
 * them into alerts that open, update and close over time.
 */
export interface Finding {
  kind: AlertKind;
  fieldId: string;
  sensorIds: string[];
  severity: Severity;
  title: string;
  detail: string;
  /** Where to draw the alert on the map, in local meters. */
  center: Meters;
  /** How far the problem extends from its center, in meters. */
  radiusM: number;
}

export interface Alert extends Finding {
  id: string;
  openedAt: number;
  updatedAt: number;
  closedAt?: number;
}
