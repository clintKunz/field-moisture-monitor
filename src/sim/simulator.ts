import type { SoilPatch } from "../config/farm";
import type { Field, LonLat, Meters, PivotField, Reading, Sensor } from "../model/types";
import { bearingDeg, distance } from "./geo";
import { createRng, gaussian } from "./random";
import { placeSensors } from "./sensors";
import { soilAt, type SoilProps } from "./soil";

export interface FarmConfig {
  origin: LonLat;
  fields: Field[];
  soilPatches: SoilPatch[];
  leaks: { fieldId: string; center: Meters; radiusM: number; mmPerHour: number }[];
  weather: { et0Mm: number; rain?: { startHour: number; hours: number; totalMm: number } }[];
  spacing: { irrigated: number; dryland: number };
  failures: { fieldId: string; nth: number; atHour: number; reason: "battery" | "radio" }[];
  start: number;
  days: number;
  intervalMin: number;
}

/** Depth of soil each probe represents, in mm. Water in/out is spread over this layer. */
const ROOT_ZONE_MM = 300;

/** Hidden physical state behind each probe. The probe only reports a noisy view of it. */
interface ProbeState {
  sensor: Sensor;
  field: Field;
  soil: SoilProps;
  /** True volumetric water content, as a fraction (0–1). */
  theta: number;
  /** Bearing from the pivot center, for irrigated fields. */
  bearingFromPivot: number | null;
  /** Extra water per hour from a nearby leak, mm. */
  leakMmPerHour: number;
  battery: number;
  batteryDrainPerHour: number;
  failsAtHour: number | null;
}

/**
 * Simulates the farm's soil water balance and produces sensor readings.
 *
 * Each 15-minute step, for every probe:
 *   water in  = rain + pivot irrigation + leaks
 *   water out = crop evapotranspiration + drainage below the root zone
 * and the probe reports the result with a little measurement noise.
 *
 * The simulator doesn't know about the UI or the event bus. It just returns
 * readings; the ingest layer decides where they go.
 */
export class FarmSimulator {
  readonly sensors: Sensor[];
  readonly totalSteps: number;
  readonly stepHours: number;
  private stepIndex = 0;
  private readonly probes: ProbeState[];
  private readonly noise: () => number;

  constructor(private readonly config: FarmConfig, seed = 42) {
    const rng = createRng(seed);
    this.noise = createRng(seed ^ 0x9e3779b9);
    this.stepHours = config.intervalMin / 60;
    this.totalSteps = Math.round((config.days * 24) / this.stepHours);
    this.sensors = placeSensors(config.fields, config.spacing, config.origin, rng);

    const failureById = new Map<string, number>();
    for (const f of config.failures) {
      const inField = this.sensors.filter((s) => s.fieldId === f.fieldId);
      const target = inField[f.nth % inField.length];
      if (target) failureById.set(target.id, f.atHour);
    }

    this.probes = this.sensors.map((sensor) => {
      const field = config.fields.find((f) => f.id === sensor.fieldId)!;
      const soil = soilAt(sensor.position, config.soilPatches);
      const available = soil.fieldCapacity - soil.wiltingPoint;
      // Irrigated fields start near field capacity; dryland starts well into the dry-down.
      const startFraction = field.kind === "irrigated" ? 0.85 + rng() * 0.1 : 0.4 + rng() * 0.15;
      const failsAtHour = failureById.get(sensor.id) ?? null;
      const battery = 70 + rng() * 30;
      return {
        sensor,
        field,
        soil,
        theta: soil.wiltingPoint + available * startFraction,
        bearingFromPivot: field.shape === "circle" ? bearingDeg(field.center, sensor.position) : null,
        leakMmPerHour: leakAt(sensor, config.leaks),
        battery,
        // A sensor with a dying battery runs down to zero by its failure hour.
        batteryDrainPerHour: failsAtHour !== null ? battery / failsAtHour : 0.01 + rng() * 0.02,
        failsAtHour,
      };
    });
  }

  /** Simulation time of the next reading batch, epoch ms. */
  get time(): number {
    return this.config.start + this.stepIndex * this.config.intervalMin * 60_000;
  }

  get done(): boolean {
    return this.stepIndex >= this.totalSteps;
  }

  /** Hours since simulation start. */
  get hour(): number {
    return this.stepIndex * this.stepHours;
  }

  /**
   * Arm angle of a pivot (degrees clockwise from north) at a given hour.
   * A stalled pivot stays parked where it broke down.
   */
  static pivotAngle(field: PivotField, hour: number): number {
    const { revolutionHours, startAngleDeg, stallsAtHour } = field.pivot;
    const h = stallsAtHour !== undefined ? Math.min(hour, stallsAtHour) : hour;
    return (startAngleDeg + (360 * h) / revolutionHours) % 360;
  }

  /** Advances one interval and returns the readings sent by sensors that are still online. */
  step(): Reading[] {
    if (this.done) return [];
    const hour = this.hour;
    const t = this.time;
    const dt = this.stepHours;
    const day = this.config.weather[Math.floor(hour / 24)] ?? { et0Mm: 7 };
    const hourOfDay = hour % 24;

    const et0Mm = day.et0Mm * diurnalShare(hourOfDay) * dt;
    const rainMm = rainDuring(day.rain, hourOfDay, dt);

    const readings: Reading[] = [];
    for (const p of this.probes) {
      const { soil, field } = p;
      const irrigationMm = field.shape === "circle" ? irrigationAt(field, p.bearingFromPivot!, hour, dt) : 0;
      const inMm = rainMm + irrigationMm + p.leakMmPerHour * dt;

      // Crops use less water as soil dries: full rate until half the available
      // water is gone, then tapering to zero at the wilting point.
      const available = soil.fieldCapacity - soil.wiltingPoint;
      const stress = clamp((p.theta - soil.wiltingPoint) / (0.5 * available), 0, 1);
      const etMm = field.cropCoefficient * et0Mm * stress;

      p.theta += (inMm - etMm) / ROOT_ZONE_MM;

      // Water above field capacity drains away; sandy soil drains much faster than clay.
      if (p.theta > soil.fieldCapacity) {
        const rate = 0.15 * Math.exp(-soil.texture * 1.2);
        p.theta -= (p.theta - soil.fieldCapacity) * (1 - Math.exp(-rate * dt));
      }
      p.theta = clamp(p.theta, soil.wiltingPoint * 0.85, soil.saturation);

      p.battery = Math.max(0, p.battery - p.batteryDrainPerHour * dt);
      if (p.failsAtHour !== null && hour >= p.failsAtHour) continue; // offline: sends nothing

      readings.push({
        sensorId: p.sensor.id,
        t,
        vwc: round1(p.theta * 100 + gaussian(this.noise) * 0.4),
        soilTempC: round1(20 + 5 * Math.sin((2 * Math.PI * (hourOfDay - 9)) / 24) - p.theta * 8 + gaussian(this.noise) * 0.3),
        batteryPct: round1(p.battery),
      });
    }

    this.stepIndex++;
    return readings;
  }
}

/** Share of a day's evapotranspiration in a given hour: zero at night, peaking mid-afternoon. */
function diurnalShare(hourOfDay: number): number {
  // sin curve from 06:00 to 20:00; its integral over those 14 hours is 28/π.
  if (hourOfDay < 6 || hourOfDay > 20) return 0;
  return Math.sin((Math.PI * (hourOfDay - 6)) / 14) / (28 / Math.PI);
}

function rainDuring(rain: FarmConfig["weather"][number]["rain"], hourOfDay: number, dt: number): number {
  if (!rain) return 0;
  const inStorm = hourOfDay >= rain.startHour && hourOfDay < rain.startHour + rain.hours;
  return inStorm ? (rain.totalMm / rain.hours) * dt : 0;
}

/** Water applied if the pivot arm sweeps across this probe's bearing during the step. */
function irrigationAt(field: PivotField, bearing: number, hour: number, dt: number): number {
  const { stallsAtHour, revolutionHours, applicationMm } = field.pivot;
  if (stallsAtHour !== undefined && hour >= stallsAtHour) return 0;
  const from = FarmSimulator.pivotAngle(field, hour);
  const sweep = (360 * dt) / revolutionHours;
  const ahead = (bearing - from + 360) % 360;
  return ahead < sweep ? applicationMm : 0;
}

function leakAt(sensor: Sensor, leaks: FarmConfig["leaks"]): number {
  let mm = 0;
  for (const leak of leaks) {
    if (leak.fieldId !== sensor.fieldId) continue;
    const d = distance(sensor.position, leak.center);
    mm += leak.mmPerHour * Math.exp(-((d / leak.radiusM) ** 2));
  }
  return mm;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
