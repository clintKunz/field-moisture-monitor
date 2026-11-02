import type { MoistureStatus } from "../model/status";

/**
 * Design tokens live in CSS (src/styles.css) as custom properties. HTML picks
 * them up automatically, but a <canvas> can't use CSS variables, so this
 * module reads the current values into a typed object the map draws with.
 * When the viewer switches between light and dark, the map is told to redraw.
 */
export interface Theme {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  ground: string;
  irrigated: string;
  dryland: string;
  pivotArm: string;
  alert: string;
  contourDry: string;
  contourWet: string;
  status: Record<MoistureStatus, string>;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function readTheme(): Theme {
  return {
    bg: token("--bg"),
    surface: token("--surface"),
    ink: token("--ink"),
    muted: token("--muted"),
    line: token("--line"),
    ground: token("--ground"),
    irrigated: token("--field-irrigated"),
    dryland: token("--field-dryland"),
    pivotArm: token("--pivot-arm"),
    alert: token("--alert"),
    contourDry: token("--contour-dry"),
    contourWet: token("--contour-wet"),
    status: {
      dry: token("--moisture-dry"),
      low: token("--moisture-low"),
      ok: token("--moisture-ok"),
      wet: token("--moisture-wet"),
      offline: token("--offline"),
    },
  };
}

/** Calls `onChange` whenever the color scheme flips (OS setting or an explicit data-theme). */
export function watchTheme(onChange: () => void): void {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onChange);
  new MutationObserver(onChange).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
