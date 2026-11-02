import { ALERT_SETTINGS } from "../config/alerts";
import type { RuleContext, Rule } from "./rules";
import type { Alert, Finding } from "./types";

export type AlertEvent = "opened" | "updated" | "closed";

/**
 * Turns stateless rule findings into alerts with a lifecycle.
 *
 * Sensor readings are noisy: a probe sitting right at the dry line will
 * flicker across it every few minutes. Without care that means an alert
 * opening and closing constantly, and people learn to ignore alerts that
 * flap. So the engine adds hysteresis:
 *   - open only after a problem shows up in N consecutive evaluations
 *   - close only after it has been absent for M consecutive evaluations
 *
 * It also keeps an alert's identity as the problem changes shape: a dry
 * spot that grows from 2 to 5 sensors is the same alert, updated, as long as
 * the new finding shares a sensor with the old one.
 */
export class AlertEngine {
  private open: Alert[] = [];
  private closed: Alert[] = [];
  private pending: { finding: Finding; seen: number }[] = [];
  private missing = new Map<string, number>();
  private nextId = 1;

  constructor(
    private readonly rules: Rule[],
    private readonly onEvent: (event: AlertEvent, alert: Alert) => void = () => {},
    private readonly settings = ALERT_SETTINGS,
  ) {}

  get active(): readonly Alert[] {
    return this.open;
  }

  get history(): readonly Alert[] {
    return this.closed;
  }

  evaluate(ctx: RuleContext): void {
    const alerting = (kind: Finding["kind"], sensorId: string) =>
      this.open.some((a) => a.kind === kind && a.sensorIds.includes(sensorId));
    const findings = this.rules.flatMap((rule) => rule({ ...ctx, alerting }));
    const stillPresent = new Set<string>();
    const nextPending: typeof this.pending = [];

    for (const finding of findings) {
      const existing = this.open.find((a) => !stillPresent.has(a.id) && sameProblem(a, finding));
      if (existing) {
        stillPresent.add(existing.id);
        this.missing.delete(existing.id);
        if (changed(existing, finding)) {
          Object.assign(existing, finding, { updatedAt: ctx.now });
          this.onEvent("updated", existing);
        }
        continue;
      }
      const seen = (this.pending.find((p) => sameProblem(p.finding, finding))?.seen ?? 0) + 1;
      if (seen >= this.settings.openAfterReadings) {
        const alert: Alert = { ...finding, id: `A${this.nextId++}`, openedAt: ctx.now, updatedAt: ctx.now };
        this.open.push(alert);
        stillPresent.add(alert.id);
        this.onEvent("opened", alert);
      } else {
        nextPending.push({ finding, seen });
      }
    }
    this.pending = nextPending;

    for (const alert of [...this.open]) {
      if (stillPresent.has(alert.id)) continue;
      const misses = (this.missing.get(alert.id) ?? 0) + 1;
      if (misses < this.settings.closeAfterReadings) {
        this.missing.set(alert.id, misses);
        continue;
      }
      this.missing.delete(alert.id);
      alert.closedAt = ctx.now;
      this.open = this.open.filter((a) => a !== alert);
      this.closed.push(alert);
      this.onEvent("closed", alert);
    }
  }
}

/** Same kind, same field, and (for sensor-based alerts) at least one sensor in common. */
function sameProblem(a: Finding, b: Finding): boolean {
  if (a.kind !== b.kind || a.fieldId !== b.fieldId) return false;
  if (a.sensorIds.length === 0 && b.sensorIds.length === 0) return true;
  return a.sensorIds.some((id) => b.sensorIds.includes(id));
}

function changed(a: Finding, b: Finding): boolean {
  return a.title !== b.title || a.detail !== b.detail || a.severity !== b.severity || a.sensorIds.join() !== b.sensorIds.join();
}
