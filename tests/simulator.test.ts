import { describe, expect, it } from "vitest";
import { FARM_CONFIG, FIELDS } from "../src/config/farm";
import { EventBus } from "../src/ingest/eventBus";
import { FarmSimulator } from "../src/sim/simulator";
import { ReadingStore } from "../src/store/readingStore";
import type { PivotField } from "../src/model/types";

function runAll(seed = 42) {
  const sim = new FarmSimulator(FARM_CONFIG, seed);
  const store = new ReadingStore();
  while (!sim.done) store.ingest(sim.step());
  return { sim, store };
}

function fieldAverage(sim: FarmSimulator, store: ReadingStore, fieldId: string, t: number) {
  const values = sim.sensors
    .filter((s) => s.fieldId === fieldId)
    .map((s) => store.at(s.id, t)?.vwc)
    .filter((v): v is number => v !== undefined);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const hourT = (h: number) => FARM_CONFIG.start + h * 3_600_000;

describe("FarmSimulator", () => {
  it("places sensors inside every field", () => {
    const sim = new FarmSimulator(FARM_CONFIG);
    for (const field of FIELDS) {
      expect(sim.sensors.filter((s) => s.fieldId === field.id).length).toBeGreaterThan(10);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = runAll(7).store.history("FMS-0010");
    const b = runAll(7).store.history("FMS-0010");
    expect(a).toEqual(b);
  });

  it("dries dryland fields out between storms", () => {
    const { sim, store } = runAll();
    expect(fieldAverage(sim, store, "D2", hourT(5 * 24))).toBeLessThan(fieldAverage(sim, store, "D2", hourT(1)));
  });

  it("wets dryland fields after the day-6 storm", () => {
    const { sim, store } = runAll();
    const before = fieldAverage(sim, store, "D1", hourT(5 * 24 + 13));
    const after = fieldAverage(sim, store, "D1", hourT(5 * 24 + 21));
    expect(after - before).toBeGreaterThan(3);
  });

  it("lets the stalled pivot dry out compared with a working one", () => {
    const { sim, store } = runAll();
    const end = hourT(14 * 24 - 1);
    expect(fieldAverage(sim, store, "P4", end)).toBeLessThan(fieldAverage(sim, store, "P1", end) - 3);
  });

  it("parks a stalled pivot arm where it broke down", () => {
    const p4 = FIELDS.find((f) => f.id === "P4") as PivotField;
    const stall = p4.pivot.stallsAtHour!;
    expect(FarmSimulator.pivotAngle(p4, stall + 50)).toBeCloseTo(FarmSimulator.pivotAngle(p4, stall));
  });

  it("stops readings from a failed sensor", () => {
    const { sim, store } = runAll();
    const reporting = sim.sensors.filter((s) => store.latest(s.id)!.t === store.latestTime).length;
    expect(reporting).toBe(sim.sensors.length - FARM_CONFIG.failures.length);
  });
});

describe("EventBus", () => {
  it("delivers events until unsubscribed", () => {
    const bus = new EventBus<{ ping: number }>();
    const got: number[] = [];
    const off = bus.on("ping", (n) => got.push(n));
    bus.emit("ping", 1);
    off();
    bus.emit("ping", 2);
    expect(got).toEqual([1]);
  });
});
