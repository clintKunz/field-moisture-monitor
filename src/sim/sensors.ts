import type { Field, LonLat, Sensor } from "../model/types";
import { containsPoint, metersToLonLat } from "./geo";

/**
 * Places probes on a jittered grid inside each field, the way an agronomist
 * would lay out a sampling grid, with a little randomness so it looks like a
 * real install rather than a perfect lattice.
 */
export function placeSensors(
  fields: Field[],
  spacing: { irrigated: number; dryland: number },
  origin: LonLat,
  rng: () => number,
): Sensor[] {
  const sensors: Sensor[] = [];
  let n = 1;

  for (const field of fields) {
    const step = spacing[field.kind];
    const [minX, minY, maxX, maxY] =
      field.shape === "circle"
        ? [field.center.x - field.radiusM, field.center.y - field.radiusM, field.center.x + field.radiusM, field.center.y + field.radiusM]
        : [field.min.x, field.min.y, field.max.x, field.max.y];

    // Inset half a step so probes don't sit on the field edge.
    for (let y = minY + step / 2; y < maxY; y += step) {
      for (let x = minX + step / 2; x < maxX; x += step) {
        const position = {
          x: x + (rng() - 0.5) * step * 0.35,
          y: y + (rng() - 0.5) * step * 0.35,
        };
        if (!containsPoint(field, position)) continue;
        sensors.push({
          id: `FMS-${String(n++).padStart(4, "0")}`,
          fieldId: field.id,
          position,
          lonLat: metersToLonLat(position, origin),
          depthCm: 30,
        });
      }
    }
  }
  return sensors;
}
