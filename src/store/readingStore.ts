import type { Reading } from "../model/types";

/**
 * Keeps every reading received, indexed by sensor, so the UI can ask for the
 * latest value (for the map) or a sensor's full history (for its chart, and
 * for replaying any moment in time).
 *
 * Readings arrive in time order, so each sensor's history is already sorted
 * and lookups by time can use binary search.
 */
export class ReadingStore {
  private bySensor = new Map<string, Reading[]>();
  private lastSeenT = 0;

  ingest(readings: Reading[]): void {
    for (const r of readings) {
      let history = this.bySensor.get(r.sensorId);
      if (!history) this.bySensor.set(r.sensorId, (history = []));
      history.push(r);
      if (r.t > this.lastSeenT) this.lastSeenT = r.t;
    }
  }

  /** Time of the newest reading received from any sensor. */
  get latestTime(): number {
    return this.lastSeenT;
  }

  history(sensorId: string): readonly Reading[] {
    return this.bySensor.get(sensorId) ?? [];
  }

  /** The sensor's most recent reading at or before time t, or undefined if it hadn't reported yet. */
  at(sensorId: string, t: number): Reading | undefined {
    const h = this.bySensor.get(sensorId);
    if (!h || h.length === 0) return undefined;
    let lo = 0;
    let hi = h.length - 1;
    if (h[0]!.t > t) return undefined;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (h[mid]!.t <= t) lo = mid;
      else hi = mid - 1;
    }
    return h[lo];
  }

  latest(sensorId: string): Reading | undefined {
    const h = this.bySensor.get(sensorId);
    return h?.[h.length - 1];
  }
}
