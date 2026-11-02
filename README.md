# Field Moisture Monitor

A TypeScript dashboard for a network of soil-moisture sensors on a farm with both
center-pivot irrigated fields and dryland fields. It shows where fields are too wet
or too dry so a grower knows where to water, and where something has gone wrong.

The farm and its sensors are simulated: about 160 probes report every 15 minutes over
two weeks in July on the Snake River Plain in eastern Idaho.

## What happens in the two weeks

- Four irrigated potato pivots and two dryland wheat fields dry out in summer heat.
- A thunderstorm on day 6 wets everything; a light shower follows on day 11.
- A sandy knoll on Pivots 2 and 3 never holds enough water, even when irrigated.
- A leaking span on Pivot 3 keeps one spot saturated.
- Pivot 4 breaks down on day 9, and its field steadily dries out.
- Two sensors go offline: one battery dies, one radio fails.

## How it's built

```
src/
  model/types.ts         Domain types: fields, sensors, readings, thresholds
  config/farm.ts         The farm as data: fields, soil, weather, failures
  sim/                   Soil water-balance simulation that produces readings
  ingest/eventBus.ts     Typed pub/sub between producers and consumers
  store/readingStore.ts  Every reading, indexed by sensor and time
  model/status.ts        Turns a reading into dry / drying / in range / saturated / offline
  alerts/                Alert rules, spot clustering and the alert engine
  config/alerts.ts       Alert tuning as data: deadband, debounce, leak and pivot timing
  analysis/              IDW interpolation and contour lines (pure functions, unit tested)
  map/                   Canvas map: d3-geo projection, fields, pivot arms, surface, sensors
  ui/theme.ts            Reads the CSS design tokens so the canvas matches the page
  ui/timeline.ts         Replay scrubber with rain bands and critical-alert marks
  ui/historyChart.ts     Per-sensor moisture chart (hand-written SVG) with the healthy band
  styles.css             Design tokens (light and dark) and layout
  main.ts                Wires simulator → bus → store → map and side panel
```

**Simulation.** Each probe tracks the true water content of the soil around it. Every
15 minutes: water in (rain, pivot irrigation, leaks) minus water out (crop
evapotranspiration, drainage). Sandy soil holds little and drains fast; clay holds a lot.
Crops use less water as the soil dries. The probe reports that value with sensor noise.

**Ingest.** The simulator emits readings onto a typed event bus, the way a LoRa gateway
or webhook would feed a queue. The store, alert rules and UI subscribe independently.

**Map.** The farm is defined in local meters, converted to GeoJSON in longitude/latitude, and
projected to the screen with d3-geo. Everything is drawn on a canvas, which stays fast as the
data grows, with screen positions cached for hover and click.

**Moisture surface.** Each field's sensors are interpolated onto a 15 m grid with inverse distance
weighting (closer sensors count more). Readings are first scaled to the field's own thresholds,
0 at the dry line and 1 at the wet line, so potatoes and dryland wheat share one color scale.
Fields are interpolated separately so irrigated and dryland readings never blend across a fence.
d3-contour (marching squares) traces lines at the dry and wet thresholds, and offline sensors
are left out so stale readings don't paint old data as current.

**Alerts.** Rules are plain functions that read the current state and return findings: dry
spots, wet spots (a spot saturated for 6+ hours is flagged as a possible leak), offline sensors,
and pivots that have stopped watering. Dry and wet sensors are grouped into named spots
("Dry spot · Pivot 2 east") with union-find clustering. The pivot rule doesn't read the
simulator's breakdown schedule; it infers a stall from the data, since a working pivot makes
probe readings jump as it passes. An alert engine subscribes to the event bus and gives findings
a lifecycle with two kinds of hysteresis so noisy readings don't make alerts flap: a problem must
persist for several readings to open, and a sensor must recover past a 1-point deadband to clear.

**Replay.** Time has two parts: the ingest head (how far the data stream has arrived) and the
playhead (the moment being viewed). The simulator, store and alert engine only move forward.
The viewer can scrub anywhere; seeking past the head fast-forwards the stream. Because the alert
engine's hysteresis depends on the order readings arrived in, it isn't re-run on scrub. Instead
the open alerts are snapshotted after every reading and the view looks up the snapshot for its time.

**Sensor history.** Selecting a sensor (or a sensor-based alert) shows its moisture over the two
weeks against the crop's healthy band, with rain shaded. Pivot passes show as a sawtooth, and a
pivot breakdown shows as the sawtooth stopping.

**Design tokens.** Every color is a CSS custom property, with light and dark sets. The canvas reads
the same tokens, so the map always matches the page. Moisture colors use a colorblind-safe
brown-to-teal scale, and offline sensors get a cross so status never relies on color alone.

**Deterministic.** A seeded random generator makes every run identical, which keeps
tests stable and replays repeatable.

## Run it

```bash
npm install
npm run dev     # local dev server
npm test        # unit tests
npm run build   # type-check and production build
```

Use the timeline under the map to scrub through the two weeks, or add `?day=10` to the URL to open partway through.

## Roadmap

1. ~~Data model and simulated sensor stream~~
2. ~~Map rendering of fields and sensors (Canvas + d3-geo)~~
3. ~~Interpolated moisture surface (IDW) with contour lines~~
4. ~~Alert rules for dry spots, wet spots and offline sensors~~
5. ~~Sensor history chart and a replay slider~~
6. Polish and publish
