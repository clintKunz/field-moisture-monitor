/**
 * Alert tuning, kept as data like the farm itself. Changing how sensitive
 * the alerts are means editing these numbers, not the rule code.
 */
export const ALERT_SETTINGS = {
  /**
   * Deadband, in VWC points. An alert opens when a sensor crosses its threshold,
   * but only clears once it is this far back on the healthy side. Like a thermostat,
   * this stops a reading drifting around the line from opening and closing alerts.
   */
  clearMargin: 1,
  /** A problem must show up in this many consecutive readings before an alert opens. */
  openAfterReadings: 2,
  /** And be gone for this many consecutive readings before it closes. */
  closeAfterReadings: 3,
  /** Sensors closer than this many grid spacings are grouped into one spot. */
  clusterLinkSpacings: 1.5,
  /** A dry spot is critical at this many sensors, or this far below the dry threshold (VWC points). */
  criticalDrySensors: 3,
  criticalDryMargin: 4,
  /** Saturated this long suggests a leak or overwatering rather than recent rain. */
  leakSuspectHours: 6,
  /** A spot covering at least this share of a field's sensors is reported as field-wide. */
  fieldWideShare: 0.6,
  /** A pivot with no watering detected for this long is flagged. */
  pivotIdleHours: 8,
  /** A jump in moisture this large between two readings counts as the pivot passing (VWC points). */
  irrigationJump: 2.5,
};
