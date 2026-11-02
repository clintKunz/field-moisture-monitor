import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";
import type { Field, LonLat, Meters, PivotField } from "../model/types";
import { metersToLonLat } from "../sim/geo";

/**
 * Turns fields defined in local meters into GeoJSON in longitude/latitude.
 * Once the farm is GeoJSON, d3-geo can project and draw it like any other
 * map data, which is also the format a GIS platform would hand us.
 */
export function fieldToFeature(field: Field, origin: LonLat): Feature<Polygon, { id: string }> {
  const ring: Meters[] = [];
  if (field.shape === "circle") {
    // GeoJSON has no circles, so approximate with a 96-sided polygon.
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * 2 * Math.PI;
      ring.push({ x: field.center.x + field.radiusM * Math.sin(a), y: field.center.y + field.radiusM * Math.cos(a) });
    }
  } else {
    const { min, max } = field;
    ring.push(min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }, min);
  }
  // d3-geo expects exterior rings wound clockwise, so reverse the counter-clockwise rectangle.
  const coords = ring.map((p) => metersToLonLat(p, origin));
  if (field.shape === "rect") coords.reverse();
  return { type: "Feature", properties: { id: field.id }, geometry: { type: "Polygon", coordinates: [coords] } };
}

export function farmCollection(fields: Field[], origin: LonLat): FeatureCollection<Polygon, { id: string }> {
  return { type: "FeatureCollection", features: fields.map((f) => fieldToFeature(f, origin)) };
}

/** The pivot arm as a line from the center to the edge at the given angle. */
export function pivotArm(field: PivotField, angleDeg: number, origin: LonLat): LineString {
  const a = (angleDeg * Math.PI) / 180;
  const tip = { x: field.center.x + field.radiusM * Math.sin(a), y: field.center.y + field.radiusM * Math.cos(a) };
  return { type: "LineString", coordinates: [metersToLonLat(field.center, origin), metersToLonLat(tip, origin)] };
}
