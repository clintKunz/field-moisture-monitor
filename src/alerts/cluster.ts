import type { Meters } from "../model/types";

/**
 * Groups nearby points into clusters: any two points within `linkM` of each
 * other end up in the same cluster, and so does anything chained through
 * them (single-linkage clustering).
 *
 * Implemented with union-find: start with every point in its own group, then
 * merge groups for each close pair. With ~30 points per field, checking every
 * pair is cheap; for thousands you'd add a spatial index first.
 */
export function clusterPoints<T extends { position: Meters }>(items: readonly T[], linkM: number): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!; // path halving keeps lookups fast
      i = parent[i]!;
    }
    return i;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!.position;
      const b = items[j]!.position;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= linkM) parent[find(i)] = find(j);
    }
  }

  const groups = new Map<number, T[]>();
  items.forEach((item, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(item);
    else groups.set(root, [item]);
  });
  return [...groups.values()];
}

/** Center of a group of points and the distance from it to the farthest point. */
export function extent(points: readonly Meters[]): { center: Meters; radiusM: number } {
  const center = {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
  const radiusM = Math.max(...points.map((p) => Math.hypot(p.x - center.x, p.y - center.y)));
  return { center, radiusM };
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

/** Describes where a point sits in a field, the way a grower would say it: "Pivot 2 east". */
export function describeLocation(point: Meters, fieldCenter: Meters, fieldSizeM: number): string {
  const dx = point.x - fieldCenter.x;
  const dy = point.y - fieldCenter.y;
  if (Math.hypot(dx, dy) < fieldSizeM * 0.2) return "center";
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return COMPASS[Math.round(((deg + 360) % 360) / 45) % 8]!;
}
