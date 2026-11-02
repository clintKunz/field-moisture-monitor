import "./styles.css";
import { FARM_CONFIG, FIELDS, WEATHER } from "./config/farm";
import { EventBus } from "./ingest/eventBus";
import type { FarmEvents } from "./ingest/events";
import { buildFieldSurface, type FieldSurface } from "./analysis/surface";
import { AlertEngine } from "./alerts/engine";
import { DEFAULT_RULES } from "./alerts/rules";
import type { Alert } from "./alerts/types";
import { MapView } from "./map/MapView";
import { classify, STATUS_LABEL, type MoistureStatus } from "./model/status";
import type { Sensor } from "./model/types";
import { FarmSimulator } from "./sim/simulator";
import { ReadingStore } from "./store/readingStore";
import { renderHistoryChart } from "./ui/historyChart";
import { Timeline } from "./ui/timeline";

/**
 * Wiring: simulator → event bus → store and alert engine → map and side panel.
 *
 * Time comes in two parts:
 *  - the ingest head: how far the data stream has arrived. The simulator,
 *    store and alert engine only ever move forward along it.
 *  - the playhead: the moment the viewer is looking at. It can move anywhere
 *    the stream has reached; seeking past the head fast-forwards the stream.
 */
const TZ = "America/Boise";
const bus = new EventBus<FarmEvents>();
const store = new ReadingStore();
const sim = new FarmSimulator(FARM_CONFIG);
const fieldById = new Map(FIELDS.map((f) => [f.id, f]));
const sensorById = new Map(sim.sensors.map((s) => [s.id, s]));
const stepMs = FARM_CONFIG.intervalMin * 60_000;
const stepTime = (step: number) => FARM_CONFIG.start + step * stepMs;

let head = -1; // last step ingested
let playhead = 0; // step being viewed

function viewAt(sensorId: string, t: number) {
  const reading = store.at(sensorId, t);
  return { reading, status: classify(reading, t, fieldById.get(sensorById.get(sensorId)!.fieldId)!.thresholds) };
}
const sensorView = (sensorId: string) => viewAt(sensorId, stepTime(playhead));

// ---- Ingest side: store, then alert engine, both subscribed to the reading stream.

bus.on("readings:batch", ({ readings }) => store.ingest(readings));

/**
 * The alert engine runs on every batch as it arrives. Its hysteresis depends
 * on the order readings arrived in, so it can't simply be re-run when the
 * viewer scrubs backward. Instead, the open alerts are snapshotted after
 * every step and the viewer looks up the snapshot for the time it shows.
 */
const engine = new AlertEngine(DEFAULT_RULES, (event, alert) => bus.emit(`alert:${event}`, alert));
const alertSnapshots: Alert[][] = [];
bus.on("readings:batch", ({ t }) => {
  engine.evaluate({ now: t, fields: FIELDS, sensors: sim.sensors, view: (id) => viewAt(id, t), history: (id) => store.history(id) });
  alertSnapshots.push(engine.active.map((a) => ({ ...a })));
});

function ingestTo(step: number) {
  while (head < step && !sim.done) {
    const t = sim.time;
    bus.emit("readings:batch", { t, readings: sim.step() });
    head++;
  }
  timeline.setLoaded(head);
}

// ---- View side.

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const map = new MapView({
  container: $("#map"),
  fields: FIELDS,
  sensors: sim.sensors,
  origin: FARM_CONFIG.origin,
  sensorView,
  onSelect: (s) => {
    selected = s;
    renderSelected();
  },
});

const rain = WEATHER.flatMap((day, d) =>
  day.rain ? [{ start: stepTime(0) + (d * 24 + day.rain.startHour) * 3_600_000, end: stepTime(0) + (d * 24 + day.rain.startHour + day.rain.hours) * 3_600_000, mm: day.rain.totalMm }] : [],
);

const timeline = new Timeline({
  container: $("#timeline-track"),
  start: FARM_CONFIG.start,
  steps: sim.totalSteps,
  stepMs,
  timeZone: TZ,
  rain,
  onSeek: (step) => {
    setPlaying(false);
    seek(step);
  },
});

bus.on("alert:opened", (alert) => {
  if (alert.severity === "critical") timeline.markAlert(Math.round((alert.openedAt - FARM_CONFIG.start) / stepMs), alert.title);
});

/** One moisture surface per field, from the sensors online at the viewed time. */
function buildSurfaces(): FieldSurface[] {
  return FIELDS.map((field) => {
    const samples = sim.sensors
      .filter((s) => s.fieldId === field.id)
      .map((s) => ({ s, v: sensorView(s.id) }))
      .filter(({ v }) => v.status !== "offline" && v.reading)
      .map(({ s, v }) => ({ x: s.position.x, y: s.position.y, value: v.reading!.vwc }));
    return buildFieldSurface(field, samples);
  });
}

for (const layer of ["surface", "contours", "sensors"] as const) {
  const box = $<HTMLInputElement>(`#layer-${layer}`);
  box.addEventListener("change", () => map.setLayers({ [layer]: box.checked }));
}

const statuses: MoistureStatus[] = ["dry", "low", "ok", "wet", "offline"];
$("#legend").innerHTML = statuses
  .map((s) => `<div><span class="swatch" style="background: var(--${s === "offline" ? "offline" : "moisture-" + s})"></span>${STATUS_LABEL[s]}</div>`)
  .join("");

const timeFmt = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ---- Selected sensor: details and history chart.

let selected: Sensor | null = null;
function renderSelected() {
  const info = $("#selected");
  const chart = $("#history");
  if (!selected) {
    info.textContent = "Click a sensor on the map, or an alert, to see its moisture history.";
    chart.innerHTML = "";
    return;
  }
  const field = fieldById.get(selected.fieldId)!;
  const { reading, status } = sensorView(selected.id);
  info.innerHTML = `<strong>${selected.id}</strong> · ${field.name}, ${field.crop}<br>
    ${reading ? `${reading.vwc.toFixed(1)}% VWC · ${reading.soilTempC.toFixed(1)}°C · battery ${Math.round(reading.batteryPct)}%<br>` : ""}
    <span class="muted">${STATUS_LABEL[status]} · healthy ${field.thresholds.dry}–${field.thresholds.wet}%</span>`;
  renderHistoryChart(chart, {
    readings: store.history(selected.id),
    thresholds: field.thresholds,
    start: FARM_CONFIG.start,
    end: stepTime(sim.totalSteps),
    playhead: stepTime(playhead),
    rain,
    timeZone: TZ,
  });
}

// ---- Alerts at the viewed time.

let focusedAlert: string | null = null;
let lastAlertKey = "";

function renderAlerts() {
  const t = stepTime(playhead);
  const open = [...(alertSnapshots[playhead] ?? [])].sort(
    (a, b) => (a.severity === b.severity ? b.openedAt - a.openedAt : a.severity === "critical" ? -1 : 1),
  );
  if (focusedAlert && !open.some((a) => a.id === focusedAlert)) focusedAlert = null;
  map.setAlerts(open, focusedAlert);

  // Rebuild the list only when something visible in it changed.
  const resolved = engine.history.filter((a) => a.closedAt! <= t).length;
  const key = open.map((a) => a.id + a.title + a.detail + a.severity).join("|") + resolved + focusedAlert;
  if (key === lastAlertKey) return;
  lastAlertKey = key;

  const critical = open.filter((a) => a.severity === "critical").length;
  const warning = open.length - critical;
  $("#alert-summary").innerHTML =
    `<span class="critical">${critical} critical</span><span class="warning">${warning} warning${warning === 1 ? "" : "s"}</span><span class="muted">${resolved} resolved</span>`;
  $("#alert-list").innerHTML = open.length
    ? open.map(alertItem).join("")
    : `<li><p class="alert-empty">No open alerts. All fields are within range.</p></li>`;
}

function alertItem(a: Alert): string {
  return `<li><button type="button" class="alert-item ${a.severity}" data-alert="${a.id}" aria-pressed="${a.id === focusedAlert}">
    <span class="sev">${a.severity}</span>
    <span class="title">${a.title}</span>
    <span class="detail">${a.detail}</span>
    <span class="since">Since ${timeFmt(a.openedAt)}</span></button></li>`;
}

$("#alert-list").addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-alert]");
  if (!button) return;
  const id = button.dataset.alert!;
  focusedAlert = focusedAlert === id ? null : id;
  // Focusing a sensor-based alert also selects its first sensor, so its history chart shows.
  const alert = alertSnapshots[playhead]?.find((a) => a.id === id);
  if (focusedAlert && alert?.sensorIds[0]) map.select(sensorById.get(alert.sensorIds[0])!);
  renderAlerts();
});

function renderFieldRows() {
  $("#field-rows").innerHTML = FIELDS.map((field) => {
    const views = sim.sensors.filter((s) => s.fieldId === field.id).map((s) => sensorView(s.id));
    const live = views.filter((v) => v.reading && v.status !== "offline");
    const avg = live.reduce((sum, v) => sum + v.reading!.vwc, 0) / (live.length || 1);
    const dry = views.filter((v) => v.status === "dry").length;
    const wet = views.filter((v) => v.status === "wet").length;
    return `<tr>
      <td>${field.name}<span class="crop">${field.crop}</span></td>
      <td class="num">${avg.toFixed(1)}%</td>
      <td class="num ${dry ? "flag" : ""}">${dry}</td>
      <td class="num ${wet ? "flag" : ""}">${wet}</td></tr>`;
  }).join("");
}

bus.on("clock:tick", ({ t, hour }) => {
  $("#clock").textContent = new Date(t).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  map.update(hour, buildSurfaces());
  renderAlerts();
  renderFieldRows();
  renderSelected();
  timeline.setPlayhead(playhead);
});

/** Moves the view to a step, streaming in data up to it first if needed. */
function seek(step: number) {
  playhead = Math.max(0, Math.min(sim.totalSteps - 1, step));
  ingestTo(playhead);
  playhead = Math.min(playhead, head);
  bus.emit("clock:tick", { t: stepTime(playhead), hour: (playhead * stepMs) / 3_600_000 });
}

// ---- Playback.

let playing = false;
let speed = 1;
let timer: number | undefined;
const playButton = $<HTMLButtonElement>("#play");

function setPlaying(on: boolean) {
  playing = on && playhead < sim.totalSteps - 1;
  playButton.textContent = playing ? "Pause" : "Play";
  playButton.setAttribute("aria-pressed", String(playing));
  window.clearTimeout(timer);
  if (playing) timer = window.setTimeout(tickPlayback, 60);
}

function tickPlayback() {
  if (playhead >= sim.totalSteps - 1) return setPlaying(false);
  seek(playhead + speed);
  timer = window.setTimeout(tickPlayback, 60);
}

playButton.addEventListener("click", () => setPlaying(!playing));
$<HTMLSelectElement>("#speed").addEventListener("change", (e) => {
  speed = Number((e.target as HTMLSelectElement).value);
});

// ?day=10 opens the replay partway through.
const startDay = Number(new URLSearchParams(location.search).get("day")) || 0;
seek(Math.round((startDay * 86_400_000) / stepMs));
setPlaying(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
