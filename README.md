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
  main.ts                Wires simulator → bus → store → UI
```

**Simulation.** Each probe tracks the true water content of the soil around it. Every
15 minutes: water in (rain, pivot irrigation, leaks) minus water out (crop
evapotranspiration, drainage). Sandy soil holds little and drains fast; clay holds a lot.
Crops use less water as the soil dries. The probe reports that value with sensor noise.

**Ingest.** The simulator emits readings onto a typed event bus, the way a LoRa gateway
or webhook would feed a queue. The store, alert rules and UI subscribe independently.

**Deterministic.** A seeded random generator makes every run identical, which keeps
tests stable and replays repeatable.

## Run it

```bash
npm install
npm run dev     # local dev server
npm test        # unit tests
npm run build   # type-check and production build
```

## Roadmap

1. ~~Data model and simulated sensor stream~~
2. Map rendering of fields and sensors (Canvas + d3-geo)
3. Interpolated moisture surface (IDW) with contour lines
4. Alert rules for dry spots, wet spots and offline sensors
5. Sensor history chart and a replay slider
6. Polish and publish
