import { contours } from "d3-contour";
import type { MultiPolygon } from "geojson";
import type { Field, Thresholds } from "../model/types";
import { containsPoint } from "../sim/geo";
import { interpolateGrid, type Bounds, type Grid, type SamplePoint } from "./idw";

/**
 * Builds the moisture surface for one field.
 *
 * Two design decisions:
 *
 * 1. Interpolate each field separately. A dryland field and an irrigated
 *    pivot next to it are different worlds; blending sensors across the
 *    fence would invent moisture that isn't there.
 *
 * 2. Normalize to a "moisture index" against the field's own thresholds:
 *    0 = at the dry threshold, 1 = at the wet threshold. Potatoes at 22% VWC
 *    and wheat at 14% VWC are both "just dry", so they both read 0, and one
 *    color scale and one set of contour lines works across every crop.
 */

export function moistureIndex(vwc: number, t: Thresholds): number {
  return (vwc - t.dry) / (t.wet - t.dry);
}

export interface FieldSurface {
  field: Field;
  grid: Grid;
  /** Contour lines in local meters, one MultiPolygon per contour level. */
  contours: { level: number; geometry: MultiPolygon }[];
}

/** Contour levels on the moisture index: the dry threshold, the middle of the band, the wet threshold. */
export const CONTOUR_LEVELS = [0, 0.5, 1];

export function fieldBounds(field: Field): Bounds {
  return field.shape === "circle"
    ? { minX: field.center.x - field.radiusM, minY: field.center.y - field.radiusM, maxX: field.center.x + field.radiusM, maxY: field.center.y + field.radiusM }
    : { minX: field.min.x, minY: field.min.y, maxX: field.max.x, maxY: field.max.y };
}

export function buildFieldSurface(field: Field, samples: readonly SamplePoint[], cellM = 15): FieldSurface {
  const indexed = samples.map((s) => ({ ...s, value: moistureIndex(s.value, field.thresholds) }));
  const grid = interpolateGrid(indexed, fieldBounds(field), cellM, (x, y) => containsPoint(field, { x, y }));

  // d3-contour (marching squares) can't handle NaN outside the field, so fill those cells
  // with a neutral mid-band value. No line is drawn there, and the map clips to the field anyway.
  const filled = Array.from(grid.values, (v) => (Number.isNaN(v) ? 0.5 : v));
  const levels = contours().size([grid.cols, grid.rows]).smooth(true).thresholds(CONTOUR_LEVELS)(filled);

  return {
    field,
    grid,
    contours: levels.map((c) => ({ level: c.value, geometry: gridToMeters(c, grid) })),
  };
}

/** d3-contour returns coordinates in grid cells; convert them to local farm meters. */
function gridToMeters(geometry: MultiPolygon, grid: Grid): MultiPolygon {
  const { minX, maxY } = grid.bounds;
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map(([c, r]) => [minX + c! * grid.cellM, maxY - r! * grid.cellM])),
    ),
  };
}
