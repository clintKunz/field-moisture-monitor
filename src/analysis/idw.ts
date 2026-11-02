/**
 * Inverse distance weighting (IDW).
 *
 * Sensors measure moisture at points, but a grower wants to see the whole
 * field. IDW estimates the value anywhere as a weighted average of the
 * sensors, where closer sensors count for more:
 *
 *   value(x) = Σ wᵢ·vᵢ / Σ wᵢ,   wᵢ = 1 / distanceᵢ^power
 *
 * With power = 2, a sensor twice as far away gets a quarter of the weight.
 * At a sensor's exact location the estimate equals that sensor's reading.
 *
 * Trade-off worth knowing: IDW is simple, fast and predictable, but it can't
 * estimate values beyond the range of the samples and makes "bullseyes"
 * around isolated sensors. Kriging models spatial correlation and gives
 * uncertainty too, at much higher cost. For a live dashboard IDW is the
 * usual first choice.
 */

export interface SamplePoint {
  x: number;
  y: number;
  value: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A regular grid of values. Row 0 is the northern edge, matching screen layout. */
export interface Grid {
  bounds: Bounds;
  cellM: number;
  cols: number;
  rows: number;
  /** Row-major values; NaN marks cells outside the area of interest. */
  values: Float32Array;
}

export function idwAt(points: readonly SamplePoint[], x: number, y: number, power = 2): number {
  let num = 0;
  let den = 0;
  const half = power / 2;
  for (const p of points) {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 < 1e-9) return p.value; // exactly on a sensor
    // Using squared distance avoids a square root per sensor: d^power = (d²)^(power/2).
    const w = 1 / (half === 1 ? d2 : d2 ** half);
    num += w * p.value;
    den += w;
  }
  return den > 0 ? num / den : NaN;
}

/** Estimates a value at every cell center inside `inside`; other cells are NaN. */
export function interpolateGrid(
  points: readonly SamplePoint[],
  bounds: Bounds,
  cellM: number,
  inside: (x: number, y: number) => boolean,
  power = 2,
): Grid {
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellM));
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cellM));
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y = bounds.maxY - (r + 0.5) * cellM;
    for (let c = 0; c < cols; c++) {
      const x = bounds.minX + (c + 0.5) * cellM;
      values[r * cols + c] = inside(x, y) && points.length > 0 ? idwAt(points, x, y, power) : NaN;
    }
  }
  return { bounds, cellM, cols, rows, values };
}
