export interface TimelineOptions {
  container: HTMLElement;
  start: number;
  steps: number;
  stepMs: number;
  timeZone: string;
  rain: { start: number; end: number; mm: number }[];
  onSeek: (step: number) => void;
}

/**
 * The replay scrubber: a native range input (so keyboard and screen readers
 * work for free) with day labels, rain bands, and a mark wherever a critical
 * alert opened. The shaded part of the track shows how much data has
 * streamed in so far; seeking past it fast-forwards the stream.
 */
export class Timeline {
  private readonly input: HTMLInputElement;
  private readonly loaded: HTMLElement;
  private readonly marks: HTMLElement;
  private marked = new Set<number>();

  constructor(private readonly o: TimelineOptions) {
    o.container.innerHTML = `
      <div class="tl-track">
        <div class="tl-loaded"></div>
        <div class="tl-marks"></div>
        <input type="range" min="0" max="${o.steps - 1}" step="1" value="0" aria-label="Replay time" />
      </div>
      <div class="tl-days"></div>`;
    this.input = o.container.querySelector("input")!;
    this.loaded = o.container.querySelector(".tl-loaded")!;
    this.marks = o.container.querySelector(".tl-marks")!;

    const pct = (time: number) => `${(((time - o.start) / (o.steps * o.stepMs)) * 100).toFixed(3)}%`;
    this.marks.innerHTML = o.rain
      .map((r) => `<span class="tl-rain" style="left:${pct(r.start)};width:max(3px, ${pct(o.start + (r.end - r.start))})" title="Rain, ${r.mm} mm"></span>`)
      .join("");

    const days = Math.round((o.steps * o.stepMs) / 86_400_000);
    o.container.querySelector(".tl-days")!.innerHTML = Array.from({ length: days }, (_, d) => {
      const t = o.start + d * 86_400_000;
      const label = new Date(t).toLocaleDateString("en-US", { timeZone: o.timeZone, month: "short", day: "numeric" });
      // Every other day on wide screens; the CSS hides every second one again on phones.
      return d % 2 === 0 ? `<span class="${d % 4 === 0 ? "" : "tl-minor"}" style="left:${pct(t)}">${label}</span>` : "";
    }).join("");

    this.input.addEventListener("input", () => o.onSeek(Number(this.input.value)));
  }

  setPlayhead(step: number): void {
    this.input.value = String(step);
    this.input.setAttribute("aria-valuetext", new Date(this.o.start + step * this.o.stepMs).toLocaleString("en-US", { timeZone: this.o.timeZone }));
  }

  setLoaded(step: number): void {
    this.loaded.style.width = `${((step + 1) / this.o.steps) * 100}%`;
  }

  /** Marks the step where a critical alert opened, labeled with the alert title on hover. */
  markAlert(step: number, title: string): void {
    if (this.marked.has(step)) return;
    this.marked.add(step);
    const mark = document.createElement("span");
    mark.className = "tl-alert";
    mark.style.left = `${(step / this.o.steps) * 100}%`;
    mark.title = title;
    this.marks.append(mark);
  }
}
