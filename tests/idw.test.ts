import { describe, expect, it } from "vitest";
import { idwAt, interpolateGrid } from "../src/analysis/idw";
import { buildFieldSurface, moistureIndex } from "../src/analysis/surface";
import { FIELDS } from "../src/config/farm";

describe("idwAt", () => {
  const points = [
    { x: 0, y: 0, value: 10 },
    { x: 100, y: 0, value: 30 },
  ];

  it("returns a sensor's own value at its location", () => {
    expect(idwAt(points, 0, 0)).toBe(10);
  });

  it("averages evenly halfway between two sensors", () => {
    expect(idwAt(points, 50, 0)).toBeCloseTo(20);
  });

  it("leans toward the nearer sensor", () => {
    // At x=25: weights 1/25² and 1/75², so the near sensor counts 9 times as much.
    expect(idwAt(points, 25, 0)).toBeCloseTo((9 * 10 + 30) / 10);
  });

  it("never goes outside the range of the samples", () => {
    for (let x = -200; x <= 300; x += 25) {
      const v = idwAt(points, x, 40);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(30);
    }
  });
});

describe("interpolateGrid", () => {
  it("marks cells outside the area as NaN", () => {
    const grid = interpolateGrid([{ x: 0, y: 0, value: 1 }], { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 50, (x) => x < 50);
    expect(grid.cols).toBe(2);
    expect(Number.isNaN(grid.values[0]!)).toBe(false);
    expect(Number.isNaN(grid.values[1]!)).toBe(true);
  });
});

describe("moisture surface", () => {
  const pivot = FIELDS.find((f) => f.id === "P1")!;

  it("maps the dry threshold to 0 and the wet threshold to 1", () => {
    expect(moistureIndex(pivot.thresholds.dry, pivot.thresholds)).toBe(0);
    expect(moistureIndex(pivot.thresholds.wet, pivot.thresholds)).toBe(1);
  });

  it("draws a dry contour around a dry sensor", () => {
    const samples = [
      { x: -800, y: 800, value: 15 }, // dry spot at the center
      { x: -800, y: 1100, value: 30 },
      { x: -500, y: 800, value: 30 },
      { x: -1100, y: 800, value: 30 },
      { x: -800, y: 500, value: 30 },
    ];
    const surface = buildFieldSurface(pivot, samples);
    const dryLine = surface.contours.find((c) => c.level === 0)!;
    // The "at least 0" region exists but has a hole where the dry spot is.
    const rings = dryLine.geometry.coordinates.flat();
    expect(rings.length).toBeGreaterThan(1);
  });
});
