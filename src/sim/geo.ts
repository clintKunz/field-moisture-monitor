import type { Field, LonLat, Meters } from "../model/types";

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_AT_EQUATOR = 111_320;

/**
 * Converts local farm meters to longitude/latitude. Over a few kilometers
 * a flat approximation is accurate to well under a meter, so there is no
 * need for a full projection library here.
 */
export function metersToLonLat(p: Meters, origin: LonLat): LonLat {
  const [lon0, lat0] = origin;
  const mPerDegLon = M_PER_DEG_LON_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  return [lon0 + p.x / mPerDegLon, lat0 + p.y / M_PER_DEG_LAT];
}

export function distance(a: Meters, b: Meters): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Compass bearing from a to b, degrees clockwise from north, in [0, 360). */
export function bearingDeg(from: Meters, to: Meters): number {
  const deg = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function containsPoint(field: Field, p: Meters): boolean {
  if (field.shape === "circle") return distance(field.center, p) <= field.radiusM;
  return p.x >= field.min.x && p.x <= field.max.x && p.y >= field.min.y && p.y <= field.max.y;
}
