import "./styles.css";
import { FARM_CONFIG, FIELDS } from "./config/farm";
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

/**
 * Wiring: simulator → event bus → store → map and side panel.
 * Each piece only talks to the bus or the store, never to each other.
 */
const bus = new EventBus<FarmEvents>();
const store = new ReadingStore();
const sim = new FarmSimulator(FARM_CONFIG);
const fieldById = new Map(FIELDS.map((f) => [f.id, f]));
let now = FARM_CONFIG.start;

bus.on("readings:batch", ({ readings }) => store.ingest(readings));

/**
 * The alert engine is just another subscriber: on each clock tick it runs the
 * rules against the store and publishes alert events back onto the bus. It
 * doesn't know the UI exists.
 */
const engine = new AlertEngine(DEFAULT_RULES, (event, alert) => bus.emit(`alert:${event}`, alert));
bus.on("clock:tick", ({ t }) => {
  now = t;
  engine.evaluate({
    now: t,
    fields: FIELDS,
    sensors: sim.sensors,
    view: sensorView,
    history: (id) => store.history(id),
  });
});

function sensorView(sensorId: string) {
  const sensor = sim.sensors.find((s) => s.id === sensorId)!;
  const reading = store.at(sensorId, now);
  return { reading, status: classify(reading, now, fieldById.get(sensor.fieldId)!.thresholds) };
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const map = new MapView({
  container: $("#map"),
  fields: FIELDS,
  sensors: sim.sensors,
  origin: FARM_CONFIG.origin,
  sensorView,
  onSelect: (s) => renderSelected(s),
});

/**
 * One moisture surface per field, from the sensors that are currently online.
 * An offline sensor's last reading would be stale, so it's left out rather
 * than painting old data as if it were current.
 */
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

// Legend, built from the same status list the map colors by.
const statuses: MoistureStatus[] = ["dry", "low", "ok", "wet", "offline"];
$("#legend").innerHTML = statuses
  .map((s) => `<div><span class="swatch" style="background: var(--${s === "offline" ? "offline" : "moisture-" + s})"></span>${STATUS_LABEL[s]}</div>`)
  .join("");

let selected: Sensor | null = null;
function renderSelected(sensor: Sensor | null) {
  selected = sensor;
  const el = $("#selected");
  if (!sensor) {
    el.textContent = "Click a sensor on the map.";
    return;
  }
  const field = fieldById.get(sensor.fieldId)!;
  const { reading, status } = sensorView(sensor.id);
  el.innerHTML = `<strong>${sensor.id}</strong> · ${field.name}<br>
    ${reading ? `${reading.vwc.toFixed(1)}% VWC, ${reading.soilTempC.toFixed(1)}°C, battery ${Math.round(reading.batteryPct)}%<br>` : ""}
    ${STATUS_LABEL[status]} · healthy range ${field.thresholds.dry}–${field.thresholds.wet}%`;
}

const timeFmt = (t: number) =>
  new Date(t).toLocaleString("en-US", { timeZone: "America/Boise", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

let focusedAlert: string | null = null;
let alertsDirty = true;
for (const event of ["alert:opened", "alert:updated", "alert:closed"] as const) {
  bus.on(event, (alert) => {
    alertsDirty = true;
    if (event === "alert:closed" && alert.id === focusedAlert) focusedAlert = null;
  });
}

function renderAlerts() {
  const open = [...engine.active].sort(
    (a, b) => (a.severity === b.severity ? b.openedAt - a.openedAt : a.severity === "critical" ? -1 : 1),
  );
  map.setAlerts(open, focusedAlert);
  if (!alertsDirty) return;
  alertsDirty = false;
  const critical = open.filter((a) => a.severity === "critical").length;
  const warning = open.length - critical;
  $("#alert-summary").innerHTML = open.length
    ? `<span class="critical">${critical} critical</span><span class="warning">${warning} warning${warning === 1 ? "" : "s"}</span><span class="muted">${engine.history.length} resolved</span>`
    : "";
  $("#alert-list").innerHTML = open.length
    ? open.map((a) => alertItem(a)).join("")
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
  alertsDirty = true;
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
  now = t;
  $("#clock").textContent = new Date(t).toLocaleString("en-US", {
    timeZone: "America/Boise", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  map.update(hour, buildSurfaces());
  renderAlerts();
  renderFieldRows();
  if (selected) renderSelected(selected);
});

// Playback: one 15-minute reading interval every 60 ms (about 4 seconds per simulated day).
let playing = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const playButton = $<HTMLButtonElement>("#play");
playButton.addEventListener("click", () => {
  playing = !playing;
  if (playing && sim.done) return;
  playButton.textContent = playing ? "Pause" : "Play";
  if (playing) loop();
});

function advance() {
  const t = sim.time;
  const hour = sim.hour;
  bus.emit("readings:batch", { t, readings: sim.step() });
  bus.emit("clock:tick", { t, hour });
}

function loop() {
  if (!playing || sim.done) {
    playing = false;
    playButton.textContent = sim.done ? "Done" : "Play";
    return;
  }
  advance();
  setTimeout(loop, 60);
}

// ?day=10 starts the replay partway through. Handy for demos until step 5 adds a time slider.
const startDay = Number(new URLSearchParams(location.search).get("day")) || 0;
do advance();
while (sim.hour < startDay * 24 && !sim.done);
playButton.textContent = playing ? "Pause" : "Play";
if (playing) loop();
