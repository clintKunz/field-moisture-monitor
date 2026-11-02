/**
 * A small typed publish/subscribe bus.
 *
 * Producers (the simulator today, a real LoRa gateway or webhook tomorrow)
 * emit events; consumers (the reading store, alert rules, the UI) subscribe.
 * Neither side knows about the other, so a new consumer can be added without
 * touching the producer. It's the same idea as webhooks feeding a queue.
 *
 * The event map type makes every event name and payload checked at compile
 * time: emitting "reading" with the wrong shape is a type error.
 */
export type Handler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Set<Handler<Events[K]>> } = {};

  /** Subscribes to an event. Returns a function that unsubscribes. */
  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const set = (this.handlers[type] ??= new Set());
    set.add(handler);
    return () => set.delete(handler);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers[type];
    if (!set) return;
    for (const handler of set) {
      // One failing consumer shouldn't stop the others from receiving the event.
      try {
        handler(payload);
      } catch (err) {
        console.error(`[eventBus] handler for "${String(type)}" failed`, err);
      }
    }
  }
}
