import type { Theme } from "../ui/theme";

/** Maps a moisture index (0 = dry threshold, 1 = wet threshold) to an RGB color. */
export type Ramp = (index: number) => [number, number, number];

/**
 * A continuous color ramp built from the same status tokens the sensors use,
 * so a sensor dot and the ground around it agree. Stops sit on the moisture
 * index: brown well below the dry line, tan just above it, teal across the
 * healthy band, deep teal past the wet line.
 */
export function moistureRamp(theme: Theme): Ramp {
  const stops: [number, [number, number, number]][] = [
    [-0.3, hexToRgb(theme.status.dry)],
    [0.1, hexToRgb(theme.status.low)],
    [0.5, hexToRgb(theme.status.ok)],
    [0.85, hexToRgb(theme.status.ok)],
    [1.2, hexToRgb(theme.status.wet)],
  ];
  return (v) => {
    if (v <= stops[0]![0]) return stops[0]![1];
    for (let i = 1; i < stops.length; i++) {
      const [x1, c1] = stops[i]!;
      if (v <= x1) {
        const [x0, c0] = stops[i - 1]!;
        const t = (v - x0) / (x1 - x0);
        return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
      }
    }
    return stops[stops.length - 1]![1];
  };
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
