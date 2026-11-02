import { describe, expect, it } from "vitest";
import { AlertEngine } from "../src/alerts/engine";
import { clusterPoints, describeLocation } from "../src/alerts/cluster";
import { DEFAULT_RULES, type Rule, type RuleContext } from "../src/alerts/rules";
import type { Alert, Finding } from "../src/alerts/types";
import { FARM_CONFIG, FIELDS } from "../src/config/farm";
import { classify } from "../src/model/status";
import { FarmSimulator } from "../src/sim/simulator";
import { ReadingStore } from "../src/store/readingStore";

describe("clusterPoints", () => {
  it("chains nearby points and separates distant ones", () => {
    const pts = [0, 100, 200, 900].map((x) => ({ position: { x, y: 0 } }));
    const groups = clusterPoints(pts, 150).map((g) => g.map((p) => p.position.x).sort((a, b) => a - b));
    expect(groups).toContainEqual([0, 100, 200]);
    expect(groups).toContainEqual([900]);
  });
});

describe("describeLocation", () => {
  it("names compass directions from the field center", () => {
    expect(describeLocation({ x: 300, y: 0 }, { x: 0, y: 0 }, 800)).toBe("east");
    expect(describeLocation({ x: -300, y: -300 }, { x: 0, y: 0 }, 800)).toBe("southwest");
    expect(describeLocation({ x: 10, y: 10 }, { x: 0, y: 0 }, 800)).toBe("center");
  });
});

describe("AlertEngine hysteresis", () => {
  const finding: Finding = {
    kind: "dry-spot", fieldId: "P1", sensorIds: ["S1"], severity: "warning",
    title: "Dry spot", detail: "", center: { x: 0, y: 0 }, radiusM: 0,
  };
  const ctx = { now: 0 } as RuleContext;

  function run(pattern: boolean[]) {
    let i = 0;
    const rule: Rule = () => (pattern[i++] ? [finding] : []);
    const events: string[] = [];
    const engine = new AlertEngine([rule], (e) => events.push(e));
    pattern.forEach(() => engine.evaluate(ctx));
    return { engine, events };
  }

  it("ignores a single noisy blip", () => {
    expect(run([true, false, false]).events).toEqual([]);
  });

  it("opens after two readings in a row", () => {
    expect(run([true, true]).events).toEqual(["opened"]);
  });

  it("stays open through a brief gap, closes after a sustained clear", () => {
    expect(run([true, true, false, true, false, false, false]).events).toEqual(["opened", "closed"]);
  });
});

describe("alerts over the two-week simulation", () => {
  const sim = new FarmSimulator(FARM_CONFIG);
  const store = new ReadingStore();
  const fieldById = new Map(FIELDS.map((f) => [f.id, f]));
  const timeline: { event: string; alert: Alert; hour: number }[] = [];
  const engine = new AlertEngine(DEFAULT_RULES, (event, alert) => timeline.push({ event, alert: { ...alert }, hour }));
  let hour = 0;
  while (!sim.done) {
    const now = sim.time;
    hour = sim.hour;
    store.ingest(sim.step());
    engine.evaluate({
      now,
      fields: FIELDS,
      sensors: sim.sensors,
      view: (id) => {
        const reading = store.at(id, now);
        return { reading, status: classify(reading, now, fieldById.get(sim.sensors.find((s) => s.id === id)!.fieldId)!.thresholds) };
      },
      history: (id) => store.history(id),
    });
  }
  const opened = timeline.filter((e) => e.event === "opened");

  it("detects Pivot 4's breakdown from the data, after it happens", () => {
    const stall = opened.find((e) => e.alert.kind === "pivot-idle" && e.alert.fieldId === "P4");
    const stallHour = (FIELDS.find((f) => f.id === "P4") as { pivot: { stallsAtHour: number } }).pivot.stallsAtHour;
    expect(stall).toBeDefined();
    expect(stall!.hour).toBeGreaterThan(stallHour);
    expect(stall!.hour).toBeLessThan(stallHour + 12);
  });

  it("never flags the working pivots as idle", () => {
    expect(opened.filter((e) => e.alert.kind === "pivot-idle" && e.alert.fieldId !== "P4")).toEqual([]);
  });

  it("flags the leak on Pivot 3 as a possible leak", () => {
    const leak = timeline.find((e) => e.alert.kind === "wet-spot" && e.alert.fieldId === "P3" && e.alert.title.startsWith("Possible leak"));
    expect(leak).toBeDefined();
  });

  it("raises one offline alert per failed sensor", () => {
    expect(opened.filter((e) => e.alert.kind === "offline")).toHaveLength(FARM_CONFIG.failures.length);
  });

  it("finds the sandy knoll on Pivot 2 as a dry spot", () => {
    expect(opened.some((e) => e.alert.kind === "dry-spot" && e.alert.fieldId === "P2")).toBe(true);
  });
});
