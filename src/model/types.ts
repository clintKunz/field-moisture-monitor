/**
 * Core domain types. Everything else in the app is built on these.
 *
 * Moisture is volumetric water content (VWC): the fraction of soil volume
 * that is water, stored here as a percentage (0–100). Agronomists and soil
 * sensor vendors report it this way, so the UI can show it unchanged.
 */

/** [longitude, latitude] in degrees, the order GeoJSON and d3-geo expect. */
export type LonLat = [number, number];

/** Local farm coordinates in meters east (x) and north (y) of the farm origin. */
export interface Meters {
  x: number;
  y: number;
}

export type FieldKind = "irrigated" | "dryland";

/** Moisture bands (VWC %) that decide what counts as dry or wet for a field. */
export interface Thresholds {
  /** Below this the crop is water-stressed: raise a dry-spot alert. */
  dry: number;
  /** Top of the healthy range. Between dry and target the field is fine. */
  target: number;
  /** Above this the soil is saturated: raise a wet-spot alert (overwatering or a leak). */
  wet: number;
}

interface FieldBase {
  id: string;
  name: string;
  crop: string;
  kind: FieldKind;
  /** Crop coefficient: how much water this crop uses relative to reference grass. */
  cropCoefficient: number;
  thresholds: Thresholds;
}

/** A center-pivot field: a circle watered by an arm rotating around its center. */
export interface PivotField extends FieldBase {
  kind: "irrigated";
  shape: "circle";
  center: Meters;
  radiusM: number;
  pivot: PivotSchedule;
}

/** A rectangular rain-fed field. */
export interface DrylandField extends FieldBase {
  kind: "dryland";
  shape: "rect";
  min: Meters;
  max: Meters;
}

export type Field = PivotField | DrylandField;

export interface PivotSchedule {
  /** Hours for the arm to make one full circle. */
  revolutionHours: number;
  /** Water applied to the soil each time the arm passes over a spot, in mm. */
  applicationMm: number;
  /** Arm angle at the start of the simulation, degrees clockwise from north. */
  startAngleDeg: number;
  /** If set, the pivot breaks down at this hour and stops watering. */
  stallsAtHour?: number;
}

/** A soil-moisture probe installed in a field. */
export interface Sensor {
  id: string;
  fieldId: string;
  position: Meters;
  lonLat: LonLat;
  /** Probe depth in cm. All probes here sit in the root zone. */
  depthCm: number;
}

/** One message from a sensor, as it would arrive from a LoRa gateway. */
export interface Reading {
  sensorId: string;
  /** Measurement time, epoch milliseconds. */
  t: number;
  /** Volumetric water content, percent. */
  vwc: number;
  soilTempC: number;
  batteryPct: number;
}
