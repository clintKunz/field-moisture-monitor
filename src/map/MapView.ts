import { geoMercator, geoPath, type GeoProjection } from "d3-geo";
import type { FeatureCollection, Polygon } from "geojson";
import { FarmSimulator } from "../sim/simulator";
import { metersToLonLat } from "../sim/geo";
import type { Field, LonLat, Reading, Sensor } from "../model/types";
import { STATUS_LABEL, type MoistureStatus } from "../model/status";
import { readTheme, watchTheme, type Theme } from "../ui/theme";
import type { FieldSurface } from "../analysis/surface";
import type { Alert } from "../alerts/types";
import { farmCollection, pivotArm } from "./geometry";
import { moistureRamp, type Ramp } from "./colorRamp";

/** What the map needs to know about one sensor right now. */
export interface SensorView {
  status: MoistureStatus;
  reading: Reading | undefined;
}

export interface MapViewOptions {
  container: HTMLElement;
  fields: Field[];
  sensors: Sensor[];
  origin: LonLat;
  /** Looks up a sensor's current state. The map doesn't know where readings are stored. */
  sensorView: (sensorId: string) => SensorView;
  onSelect?: (sensor: Sensor | null) => void;
}

/** Map layers the viewer can switch on and off. */
export interface Layers {
  surface: boolean;
  contours: boolean;
  sensors: boolean;
}

/**
 * Draws the farm on a <canvas> using d3-geo for the projection.
 *
 * Why canvas instead of SVG: SVG creates a DOM node per shape, which gets slow
 * with thousands of points or a raster surface (step 3). Canvas draws pixels
 * directly, so we redraw the whole frame each tick and keep our own list of
 * screen positions for hover and click.
 */
export class MapView {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tooltip = document.createElement("div");
  private readonly projection: GeoProjection = geoMercator();
  private readonly farm: FeatureCollection<Polygon, { id: string }>;
  private theme: Theme = readTheme();
  private ramp: Ramp = moistureRamp(this.theme);
  private surfaces: FieldSurface[] = [];
  private alerts: readonly Alert[] = [];
  private focusedAlertId: string | null = null;
  private layers: Layers = { surface: true, contours: true, sensors: true };
  /** One small offscreen canvas per field, reused every frame to hold its raster. */
  private rasters = new Map<string, HTMLCanvasElement>();
  private width = 0;
  private height = 0;
  private hour = 0;
  private hovered: Sensor | null = null;
  private selected: Sensor | null = null;
  /** Screen position of every sensor, refreshed when the map is resized. */
  private screen = new Map<string, [number, number]>();

  constructor(private readonly opts: MapViewOptions) {
    this.ctx = this.canvas.getContext("2d")!;
    this.farm = farmCollection(opts.fields, opts.origin);
    this.tooltip.className = "tooltip";
    this.tooltip.hidden = true;
    opts.container.append(this.canvas, this.tooltip);

    new ResizeObserver(() => this.resize()).observe(opts.container);
    watchTheme(() => {
      this.theme = readTheme();
      this.ramp = moistureRamp(this.theme);
      this.draw();
    });
    this.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.canvas.addEventListener("pointerleave", () => this.setHovered(null));
    this.canvas.addEventListener("click", () => this.select(this.hovered));
    this.resize();
  }

  /** Updates the simulation hour (moves the pivot arms) and the moisture surfaces, then redraws. */
  update(hour: number, surfaces: FieldSurface[]): void {
    this.hour = hour;
    this.surfaces = surfaces;
    this.draw();
    if (this.hovered) this.renderTooltip(this.hovered);
  }

  /** Shows open alerts as rings on the map; the focused one is drawn heavier and labeled. */
  setAlerts(alerts: readonly Alert[], focusedId: string | null = this.focusedAlertId): void {
    this.alerts = alerts;
    this.focusedAlertId = focusedId;
    this.draw();
  }

  setLayers(layers: Partial<Layers>): void {
    this.layers = { ...this.layers, ...layers };
    this.draw();
  }

  select(sensor: Sensor | null): void {
    this.selected = sensor;
    this.opts.onSelect?.(sensor);
    this.draw();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.opts.container;
    if (w === 0 || h === 0) return;
    // Back the canvas with device pixels so lines stay crisp on high-density screens.
    const dpr = window.devicePixelRatio || 1;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Scale and center the projection so the whole farm fits with some padding.
    this.projection.fitExtent([[28, 28], [w - 28, h - 44]], this.farm);
    this.screen.clear();
    for (const s of this.opts.sensors) {
      const p = this.projection(s.lonLat);
      if (p) this.screen.set(s.id, [p[0], p[1]]);
    }
    this.draw();
  }

  private draw(): void {
    const { ctx, theme, width, height } = this;
    if (!width) return;
    const path = geoPath(this.projection, ctx);

    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, width, height);

    // Fields: fill by type, then outline and label.
    for (const feature of this.farm.features) {
      const field = this.opts.fields.find((f) => f.id === feature.properties.id)!;
      ctx.beginPath();
      path(feature);
      ctx.fillStyle = field.kind === "irrigated" ? theme.irrigated : theme.dryland;
      ctx.fill();
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // The interpolated surface and contours, each clipped to its own field.
    for (const surface of this.surfaces) {
      const feature = this.farm.features.find((f) => f.properties.id === surface.field.id)!;
      ctx.save();
      ctx.beginPath();
      path(feature);
      ctx.clip();
      if (this.layers.surface) this.drawSurface(surface);
      if (this.layers.contours) this.drawContours(surface);
      ctx.restore();
      ctx.beginPath();
      path(feature);
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Pivot arms at their current angle. A stalled pivot is drawn dashed in the alert color.
    for (const field of this.opts.fields) {
      if (field.shape !== "circle") continue;
      const stalled = field.pivot.stallsAtHour !== undefined && this.hour >= field.pivot.stallsAtHour;
      ctx.beginPath();
      path(pivotArm(field, FarmSimulator.pivotAngle(field, this.hour), this.opts.origin));
      ctx.strokeStyle = stalled ? theme.alert : theme.pivotArm;
      ctx.lineWidth = 3;
      ctx.setLineDash(stalled ? [6, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      const c = this.projection(metersToLonLat(field.center, this.opts.origin));
      if (c) {
        ctx.beginPath();
        ctx.arc(c[0], c[1], 4, 0, 2 * Math.PI);
        ctx.fillStyle = stalled ? theme.alert : theme.pivotArm;
        ctx.fill();
      }
    }

    this.drawAlerts();

    // Sensors, colored by moisture status. Smaller when the surface is showing, so they don't hide it.
    const r = this.layers.surface ? 4 : 5;
    for (const sensor of this.layers.sensors ? this.opts.sensors : []) {
      const p = this.screen.get(sensor.id);
      if (!p) continue;
      const { status } = this.opts.sensorView(sensor.id);
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);
      ctx.fillStyle = theme.status[status];
      ctx.fill();
      ctx.strokeStyle = theme.surface;
      ctx.lineWidth = this.layers.surface ? 1 : 1.5;
      ctx.stroke();
      if (status === "offline") {
        // A cross as well as gray, so offline doesn't rely on color alone.
        ctx.beginPath();
        ctx.moveTo(p[0] - 3, p[1] - 3);
        ctx.lineTo(p[0] + 3, p[1] + 3);
        ctx.moveTo(p[0] + 3, p[1] - 3);
        ctx.lineTo(p[0] - 3, p[1] + 3);
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    for (const [sensor, color, r] of [[this.hovered, theme.ink, 9], [this.selected, theme.pivotArm, 11]] as const) {
      const p = sensor && this.screen.get(sensor.id);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    this.drawFieldLabels(path);
    this.drawScaleBar();
  }

  /**
   * Paints one field's grid as an image: one pixel per grid cell, colored by
   * the moisture ramp, then stretched over the field's footprint on screen
   * with smoothing on. Over a couple of kilometers the projection is
   * effectively linear, so stretching the image matches the map.
   */
  private drawSurface(surface: FieldSurface): void {
    const { grid, field } = surface;
    let raster = this.rasters.get(field.id);
    if (!raster) {
      raster = document.createElement("canvas");
      this.rasters.set(field.id, raster);
    }
    raster.width = grid.cols;
    raster.height = grid.rows;
    const rctx = raster.getContext("2d")!;
    const image = rctx.createImageData(grid.cols, grid.rows);
    for (let i = 0; i < grid.values.length; i++) {
      const v = grid.values[i]!;
      if (Number.isNaN(v)) continue; // transparent outside the field
      const [r, g, b] = this.ramp(v);
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = g;
      image.data[i * 4 + 2] = b;
      image.data[i * 4 + 3] = 235;
    }
    rctx.putImageData(image, 0, 0);

    const { minX, minY, maxX, maxY } = grid.bounds;
    const nw = this.projection(metersToLonLat({ x: minX, y: minY + grid.rows * grid.cellM }, this.opts.origin));
    const se = this.projection(metersToLonLat({ x: minX + grid.cols * grid.cellM, y: minY }, this.opts.origin));
    if (!nw || !se || maxX < minX || maxY < minY) return;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(raster, nw[0], nw[1], se[0] - nw[0], se[1] - nw[1]);
  }

  /**
   * Contour lines: solid at the dry and wet thresholds, a faint dashed line
   * through the middle of the healthy band. Points are projected one by one
   * rather than through geoPath, because d3-contour's ring winding isn't what
   * d3-geo's spherical clipping expects.
   */
  private drawContours(surface: FieldSurface): void {
    const { ctx, theme } = this;
    for (const { level, geometry } of surface.contours) {
      ctx.beginPath();
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          ring.forEach(([x, y], i) => {
            const p = this.projection(metersToLonLat({ x: x!, y: y! }, this.opts.origin));
            if (!p) return;
            if (i === 0) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
          });
        }
      }
      if (level === 0.5) {
        ctx.strokeStyle = theme.muted;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
      } else {
        ctx.strokeStyle = level === 0 ? theme.contourDry : theme.contourWet;
        ctx.lineWidth = 2;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
  }

  /**
   * Each alert as a dashed ring around the area it covers. Severity shows in
   * line weight and dash pattern as well as color, so it reads without color.
   */
  private drawAlerts(): void {
    const { ctx, theme } = this;
    const focused = this.alerts.find((a) => a.id === this.focusedAlertId);
    for (const alert of [...this.alerts.filter((a) => a !== focused), ...(focused ? [focused] : [])]) {
      const c = this.projection(metersToLonLat(alert.center, this.opts.origin));
      const edge = this.projection(metersToLonLat({ x: alert.center.x + alert.radiusM, y: alert.center.y }, this.opts.origin));
      if (!c || !edge) continue;
      const pad = alert.kind === "pivot-idle" ? 6 : 12;
      const r = Math.max(10, edge[0] - c[0]) + pad;
      const isFocused = alert === focused;
      ctx.beginPath();
      ctx.arc(c[0], c[1], r, 0, 2 * Math.PI);
      ctx.strokeStyle = alert.severity === "critical" ? theme.alert : theme.warning;
      ctx.lineWidth = isFocused ? 3.5 : alert.severity === "critical" ? 2.5 : 1.5;
      ctx.setLineDash(alert.severity === "critical" ? [8, 4] : [3, 4]);
      ctx.globalAlpha = this.focusedAlertId && !isFocused ? 0.45 : 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (isFocused) {
        ctx.font = "600 12px " + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = "center";
        ctx.lineJoin = "round";
        ctx.strokeStyle = theme.surface;
        ctx.lineWidth = 4;
        const label = alert.title.split(" · ")[0]!;
        const y = c[1] - r - 8 < 14 ? c[1] + r + 16 : c[1] - r - 8;
        ctx.strokeText(label, c[0], y);
        ctx.fillStyle = alert.severity === "critical" ? theme.alert : theme.ink;
        ctx.fillText(label, c[0], y);
      }
    }
  }

  /** Field names, drawn last with a halo in the field's own color so sensor dots never hide them. */
  private drawFieldLabels(path: ReturnType<typeof geoPath>): void {
    const { ctx, theme } = this;
    ctx.font = "600 12px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const feature of this.farm.features) {
      const field = this.opts.fields.find((f) => f.id === feature.properties.id)!;
      const [cx, cy] = path.centroid(feature);
      const [[, top], [, bottom]] = path.bounds(feature);
      // Pivot labels sit between the center and the rim so the arm's hub doesn't cover them.
      const y = field.shape === "circle" ? cy - (bottom - top) * 0.3 : cy;
      ctx.strokeStyle = field.kind === "irrigated" ? theme.irrigated : theme.dryland;
      ctx.lineWidth = 4;
      ctx.strokeText(field.name, cx, y);
      ctx.fillStyle = theme.ink;
      ctx.fillText(field.name, cx, y);
    }
    ctx.textBaseline = "alphabetic";
  }

  /** A 500 m scale bar, measured through the same projection as everything else. */
  private drawScaleBar(): void {
    const { ctx, theme } = this;
    const a = this.projection(this.opts.origin);
    const b = this.projection(metersToLonLat({ x: 500, y: 0 }, this.opts.origin));
    if (!a || !b) return;
    const len = b[0] - a[0];
    const x = 16;
    const y = this.height - 18;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.lineTo(x + len, y - 5);
    ctx.stroke();
    ctx.fillStyle = theme.ink;
    ctx.font = "12px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "left";
    ctx.fillText("500 m", x + len + 6, y);
  }

  private onPointerMove(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Nearest sensor within 12px. A linear scan is fine for ~160 points.
    let best: Sensor | null = null;
    let bestD = 12 * 12;
    for (const s of this.opts.sensors) {
      const p = this.screen.get(s.id);
      if (!p) continue;
      const d = (p[0] - mx) ** 2 + (p[1] - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    this.canvas.style.cursor = best ? "pointer" : "default";
    this.setHovered(best);
  }

  private setHovered(sensor: Sensor | null): void {
    if (sensor === this.hovered) return;
    this.hovered = sensor;
    this.draw();
    if (sensor) this.renderTooltip(sensor);
    else this.tooltip.hidden = true;
  }

  private renderTooltip(sensor: Sensor): void {
    const { status, reading } = this.opts.sensorView(sensor.id);
    const field = this.opts.fields.find((f) => f.id === sensor.fieldId)!;
    this.tooltip.innerHTML = `
      <strong>${sensor.id}</strong>
      <span class="muted">${field.name} · ${field.crop}</span><br>
      ${reading ? `${reading.vwc.toFixed(1)}% VWC · ${reading.soilTempC.toFixed(1)}°C · battery ${Math.round(reading.batteryPct)}%<br>` : ""}
      ${STATUS_LABEL[status]}`;
    this.tooltip.hidden = false;
    const p = this.screen.get(sensor.id)!;
    // Flip the tooltip to the other side near the right or bottom edge.
    const tw = this.tooltip.offsetWidth;
    const th = this.tooltip.offsetHeight;
    this.tooltip.style.left = `${p[0] + 14 + tw > this.width ? p[0] - 14 - tw : p[0] + 14}px`;
    this.tooltip.style.top = `${p[1] + 14 + th > this.height ? p[1] - 14 - th : p[1] + 14}px`;
  }
}
