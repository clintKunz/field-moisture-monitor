import { FARM_CONFIG, FIELDS } from "./config/farm";
import { EventBus } from "./ingest/eventBus";
import type { FarmEvents } from "./ingest/events";
import { FarmSimulator } from "./sim/simulator";
import { ReadingStore } from "./store/readingStore";

/**
 * Step 1 wiring: simulator → event bus → store, with a plain table that
 * proves data is flowing. Step 2 replaces the table with the map.
 */
const bus = new EventBus<FarmEvents>();
const store = new ReadingStore();
const sim = new FarmSimulator(FARM_CONFIG);

bus.on("readings:batch", ({ readings }) => store.ingest(readings));

const tbody = document.querySelector<HTMLTableSectionElement>("#fields tbody")!;
const clock = document.querySelector<HTMLElement>("#clock")!;
const count = document.querySelector<HTMLElement>("#count")!;
let received = 0;
bus.on("readings:batch", ({ readings }) => (received += readings.length));

bus.on("clock:tick", ({ t }) => {
  clock.textContent = new Date(t).toLocaleString("en-US", { timeZone: "America/Boise", dateStyle: "medium", timeStyle: "short" });
  count.textContent = received.toLocaleString();
  tbody.innerHTML = FIELDS.map((field) => {
    const values = sim.sensors
      .filter((s) => s.fieldId === field.id)
      .map((s) => store.latest(s.id))
      .filter((r) => r !== undefined && r.t === t)
      .map((r) => r!.vwc);
    const total = sim.sensors.filter((s) => s.fieldId === field.id).length;
    const avg = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    const dry = values.filter((v) => v < field.thresholds.dry).length;
    const wet = values.filter((v) => v > field.thresholds.wet).length;
    return `<tr><td>${field.name}</td><td>${field.crop}</td><td>${values.length}/${total}</td>
      <td>${avg.toFixed(1)}%</td><td>${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)}%</td>
      <td>${dry}</td><td>${wet}</td></tr>`;
  }).join("");
});

// Play the two weeks back: one 15-minute reading interval every 40 ms.
function tick() {
  if (sim.done) return;
  const t = sim.time;
  const hour = sim.hour;
  bus.emit("readings:batch", { t, readings: sim.step() });
  bus.emit("clock:tick", { t, hour });
  setTimeout(tick, 40);
}
tick();
