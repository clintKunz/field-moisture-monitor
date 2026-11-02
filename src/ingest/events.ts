import type { Alert } from "../alerts/types";
import type { Reading } from "../model/types";

/** Every event that flows through the app, with its payload type. */
export type FarmEvents = {
  /** A batch of readings received in one reporting interval. */
  "readings:batch": { t: number; readings: Reading[] };
  /** The simulation clock moved; t is epoch ms. */
  "clock:tick": { t: number; hour: number };
  /** Alert lifecycle, published by the alert engine. */
  "alert:opened": Alert;
  "alert:updated": Alert;
  "alert:closed": Alert;
};
