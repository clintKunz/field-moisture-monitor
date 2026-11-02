import type { Reading, Thresholds } from "../model/types";

export interface HistoryChartOptions {
  readings: readonly Reading[];
  thresholds: Thresholds;
  /** Full time range of the replay, epoch ms. */
  start: number;
  end: number;
  /** Time being viewed. Data after it is drawn faded. */
  playhead: number;
  /** Rain events, drawn as shaded bands so a jump in the line has a visible cause. */
  rain: { start: number; end: number; mm: number }[];
  timeZone: string;
}

const W = 300;
const H = 160;
const M = { top: 10, right: 8, bottom: 22, left: 30 };

/**
 * A moisture-over-time chart for one sensor, drawn as hand-written SVG.
 *
 * The healthy band between the crop's dry and wet thresholds is shaded, so
 * the question "is this sensor OK?" is answered by whether the line sits in
 * the band, before reading any numbers. Colors come from the CSS design
 * tokens, so the chart follows light and dark mode with the rest of the page.
 */
export function renderHistoryChart(el: HTMLElement, o: HistoryChartOptions): void {
  const { readings, thresholds: t } = o;
  const values = readings.map((r) => r.vwc);
  const lo = Math.floor((Math.min(t.dry - 6, ...values) - 1) / 5) * 5;
  const hi = Math.ceil((Math.max(t.wet + 4, ...values) + 1) / 5) * 5;
  const x = (time: number) => M.left + ((time - o.start) / (o.end - o.start)) * (W - M.left - M.right);
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * (H - M.top - M.bottom);
  const f = (n: number) => n.toFixed(1);

  // Split the line at the playhead: solid up to the time being viewed, faded after.
  const past: string[] = [];
  const future: string[] = [];
  let last: Reading | undefined;
  for (const r of readings) {
    const pt = `${f(x(r.t))},${f(y(r.vwc))}`;
    if (r.t <= o.playhead) {
      past.push(pt);
      last = r;
    } else {
      if (future.length === 0 && past.length) future.push(past[past.length - 1]!);
      future.push(pt);
    }
  }

  const yTicks: number[] = [];
  for (let v = lo; v <= hi; v += 10) yTicks.push(v);
  const dayMs = 86_400_000;
  const xTicks: number[] = [];
  // Every other day, stopping short of the right edge so the last label isn't clipped.
  for (let d = 0; o.start + d * dayMs < o.end - dayMs; d += 2) xTicks.push(o.start + d * dayMs);
  const dayLabel = (time: number) => new Date(time).toLocaleDateString("en-US", { timeZone: o.timeZone, month: "short", day: "numeric" });

  el.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" class="history-chart" role="img"
       aria-label="Soil moisture over time. Healthy range ${t.dry} to ${t.wet} percent.${last ? ` Latest ${last.vwc.toFixed(1)} percent.` : ""}">
    ${o.rain.map((r) => `<rect x="${f(x(r.start))}" y="${M.top}" width="${f(Math.max(2, x(r.end) - x(r.start)))}" height="${H - M.top - M.bottom}" class="hc-rain"><title>Rain, ${r.mm} mm</title></rect>`).join("")}
    <rect x="${M.left}" y="${f(y(t.wet))}" width="${W - M.left - M.right}" height="${f(y(t.dry) - y(t.wet))}" class="hc-band"/>
    ${yTicks.map((v) => `<line x1="${M.left}" x2="${W - M.right}" y1="${f(y(v))}" y2="${f(y(v))}" class="hc-grid"/><text x="${M.left - 5}" y="${f(y(v))}" class="hc-axis" text-anchor="end" dominant-baseline="middle">${v}%</text>`).join("")}
    ${xTicks.map((time) => `<text x="${f(x(time))}" y="${H - 6}" class="hc-axis" text-anchor="middle">${dayLabel(time)}</text>`).join("")}
    <line x1="${M.left}" x2="${W - M.right}" y1="${f(y(t.dry))}" y2="${f(y(t.dry))}" class="hc-dry"/>
    <line x1="${M.left}" x2="${W - M.right}" y1="${f(y(t.wet))}" y2="${f(y(t.wet))}" class="hc-wet"/>
    ${future.length > 1 ? `<polyline points="${future.join(" ")}" class="hc-line hc-future"/>` : ""}
    ${past.length > 1 ? `<polyline points="${past.join(" ")}" class="hc-line"/>` : ""}
    <line x1="${f(x(o.playhead))}" x2="${f(x(o.playhead))}" y1="${M.top}" y2="${H - M.bottom}" class="hc-playhead"/>
    ${last ? `<circle cx="${f(x(last.t))}" cy="${f(y(last.vwc))}" r="3.5" class="hc-dot"/>` : ""}
  </svg>`;
}
