import "./styles.css";
import { FARM_CONFIG, FIELDS } from "./config/farm";
import { EventBus } from "./ingest/eventBus";
import type { FarmEvents } from "./ingest/events";
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
  map.update(hour);
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

advance();
playButton.textContent = playing ? "Pause" : "Play";
if (playing) loop();
