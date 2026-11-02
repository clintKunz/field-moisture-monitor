import type { Field, LonLat, Meters } from "../model/types";

/**
 * The demo farm, defined entirely as data. Adding a field, moving a sensor
 * grid or changing a threshold means editing this file, not the code that
 * renders or simulates it.
 *
 * The farm is fictional, placed on the Snake River Plain in eastern Idaho,
 * where irrigated potatoes and dryland wheat grow side by side.
 */

/** Farm origin: local coordinate (0, 0). */
export const FARM_ORIGIN: LonLat = [-112.18, 43.36];

/** Simulation window: two weeks in July, peak irrigation season. */
export const SIM_START = Date.UTC(2026, 6, 1, 6, 0); // July 1, 00:00 Mountain time
export const SIM_DAYS = 14;
/** Sensors report every 15 minutes, a common LoRa soil-probe interval. */
export const READING_INTERVAL_MIN = 15;

const potatoThresholds = { dry: 22, target: 31, wet: 40 };
const wheatThresholds = { dry: 14, target: 24, wet: 36 };

export const FIELDS: Field[] = [
  {
    id: "P1",
    name: "Pivot 1",
    crop: "Russet potatoes",
    kind: "irrigated",
    shape: "circle",
    center: { x: -800, y: 800 },
    radiusM: 390,
    cropCoefficient: 1.15,
    thresholds: potatoThresholds,
    pivot: { revolutionHours: 60, applicationMm: 22, startAngleDeg: 0 },
  },
  {
    id: "P2",
    name: "Pivot 2",
    crop: "Russet potatoes",
    kind: "irrigated",
    shape: "circle",
    center: { x: 0, y: 800 },
    radiusM: 390,
    cropCoefficient: 1.15,
    thresholds: potatoThresholds,
    pivot: { revolutionHours: 60, applicationMm: 22, startAngleDeg: 120 },
  },
  {
    id: "P3",
    name: "Pivot 3",
    crop: "Russet potatoes",
    kind: "irrigated",
    shape: "circle",
    center: { x: 800, y: 800 },
    radiusM: 390,
    cropCoefficient: 1.15,
    thresholds: potatoThresholds,
    pivot: { revolutionHours: 60, applicationMm: 22, startAngleDeg: 240 },
  },
  {
    id: "P4",
    name: "Pivot 4",
    crop: "Seed potatoes",
    kind: "irrigated",
    shape: "circle",
    center: { x: -800, y: 0 },
    radiusM: 390,
    cropCoefficient: 1.1,
    thresholds: potatoThresholds,
    // Story beat: this pivot breaks down on day 9 and part of the field dries out.
    pivot: { revolutionHours: 60, applicationMm: 22, startAngleDeg: 60, stallsAtHour: 9 * 24 + 7 },
  },
  {
    id: "D1",
    name: "East Bench",
    crop: "Dryland winter wheat",
    kind: "dryland",
    shape: "rect",
    min: { x: -380, y: -380 },
    max: { x: 1200, y: 380 },
    cropCoefficient: 0.6,
    thresholds: wheatThresholds,
  },
  {
    id: "D2",
    name: "South Bench",
    crop: "Dryland winter wheat",
    kind: "dryland",
    shape: "rect",
    min: { x: -1200, y: -1200 },
    max: { x: 1200, y: -420 },
    cropCoefficient: 0.55,
    thresholds: wheatThresholds,
  },
];

/** Soil varies across the farm. Each patch nudges soil texture within its radius. */
export interface SoilPatch {
  center: Meters;
  radiusM: number;
  /** -1 = sandy (drains fast, holds little), +1 = clay (holds a lot, drains slowly). */
  texture: number;
  label: string;
}

export const SOIL_PATCHES: SoilPatch[] = [
  { center: { x: 380, y: 880 }, radiusM: 260, texture: -1, label: "Sandy knoll" },
  { center: { x: -950, y: -150 }, radiusM: 220, texture: -0.8, label: "Gravel ridge" },
  { center: { x: 600, y: -760 }, radiusM: 320, texture: 1, label: "Clay swale" },
  { center: { x: 900, y: 0 }, radiusM: 260, texture: 0.6, label: "Low spot" },
  { center: { x: -700, y: -850 }, radiusM: 300, texture: -0.9, label: "Sandy slope" },
];

/** A leaking pivot span: steady extra water around one spot. */
export const LEAKS = [{ fieldId: "P3", center: { x: 960, y: 640 }, radiusM: 120, mmPerHour: 5 }];

/**
 * Daily weather. Reference evapotranspiration (ET0) is how much water a
 * well-watered grass surface loses to the air in a day; July in eastern
 * Idaho runs about 6–8 mm/day.
 */
export const WEATHER: { et0Mm: number; rain?: { startHour: number; hours: number; totalMm: number } }[] = [
  { et0Mm: 7.2 },
  { et0Mm: 7.6 },
  { et0Mm: 7.9 },
  { et0Mm: 7.4 },
  { et0Mm: 6.1 },
  { et0Mm: 3.2, rain: { startHour: 14, hours: 6, totalMm: 24 } }, // day 6 thunderstorm
  { et0Mm: 4.8 },
  { et0Mm: 6.6 },
  { et0Mm: 7.3 },
  { et0Mm: 7.8 },
  { et0Mm: 5.0, rain: { startHour: 3, hours: 3, totalMm: 5 } },
  { et0Mm: 7.0 },
  { et0Mm: 7.7 },
  { et0Mm: 8.1 },
];

/** Sensor spacing in meters; dryland gets a sparser grid since it changes slowly. */
export const SENSOR_SPACING = { irrigated: 150, dryland: 210 };

/** Sensors that will drop off the network, to exercise offline alerts. */
export const SENSOR_FAILURES = [
  { fieldId: "D2", nth: 9, atHour: 4 * 24 + 2, reason: "battery" as const },
  { fieldId: "P1", nth: 5, atHour: 10 * 24 + 15, reason: "radio" as const },
];

/** Everything the simulator needs, in one object. */
export const FARM_CONFIG = {
  origin: FARM_ORIGIN,
  fields: FIELDS,
  soilPatches: SOIL_PATCHES,
  leaks: LEAKS,
  weather: WEATHER,
  spacing: SENSOR_SPACING,
  failures: SENSOR_FAILURES,
  start: SIM_START,
  days: SIM_DAYS,
  intervalMin: READING_INTERVAL_MIN,
};
