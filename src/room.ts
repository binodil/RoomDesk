// The room model used for calibration.
//
// Instead of marking 4 corners for each of the 5 surfaces (20 clicks), the room is
// described by 8 points that the surfaces share:
//   * the 4 corners of the back wall, and
//   * the 4 points where the room's edges leave the photo (usually near the
//     photo's corners).
// Each surface is a four-cornered shape made from these points, so moving one
// corner updates every surface that touches it.

import type { Point, Quad } from "./homography";

export type PointName =
  | "backTL" | "backTR" | "backBR" | "backBL"
  | "frontTL" | "frontTR" | "frontBR" | "frontBL";

export type SurfaceName = "back" | "left" | "right" | "floor" | "ceiling";

/** Points stored as fractions of the screen (0 = left/top, 1 = right/bottom). */
export type Calibration = { version: 1; points: Record<PointName, Point> };

export const POINT_NAMES: PointName[] = [
  "backTL", "backTR", "backBR", "backBL", "frontTL", "frontTR", "frontBR", "frontBL",
];

/** Corners of each surface, in the order top-left, top-right, bottom-right, bottom-left
 *  as seen when facing that surface. */
export const SURFACES: Record<SurfaceName, [PointName, PointName, PointName, PointName]> = {
  back: ["backTL", "backTR", "backBR", "backBL"],
  left: ["frontTL", "backTL", "backBL", "frontBL"],
  right: ["backTR", "frontTR", "frontBR", "backBR"],
  floor: ["backBL", "backBR", "frontBR", "frontBL"],
  ceiling: ["frontTL", "frontTR", "backTR", "backTL"],
};

export const SURFACE_LABELS: Record<SurfaceName, string> = {
  back: "Back wall",
  left: "Left wall",
  right: "Right wall",
  floor: "Floor",
  ceiling: "Ceiling",
};

/** Matches the built-in sample room picture exactly. */
export function defaultCalibration(): Calibration {
  return {
    version: 1,
    points: {
      backTL: { x: 330 / 1920, y: 172 / 1080 },
      backTR: { x: 1588 / 1920, y: 172 / 1080 },
      backBR: { x: 1588 / 1920, y: 866 / 1080 },
      backBL: { x: 330 / 1920, y: 866 / 1080 },
      frontTL: { x: 0, y: 0 },
      frontTR: { x: 1, y: 0 },
      frontBR: { x: 1, y: 1 },
      frontBL: { x: 0, y: 1 },
    },
  };
}

/** Accept only well-formed saved data; anything else falls back to the default. */
export function parseCalibration(data: unknown): Calibration {
  const fallback = defaultCalibration();
  if (!data || typeof data !== "object") return fallback;
  const points = (data as { points?: unknown }).points;
  if (!points || typeof points !== "object") return fallback;
  const out = fallback;
  for (const name of POINT_NAMES) {
    const p = (points as Record<string, unknown>)[name] as Partial<Point> | undefined;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      out.points[name] = { x: p.x as number, y: p.y as number };
    }
  }
  return out;
}

/** A surface's corners in screen pixels. */
export function surfaceQuad(cal: Calibration, surface: SurfaceName, width: number, height: number): Quad {
  return SURFACES[surface].map((n) => ({
    x: cal.points[n].x * width,
    y: cal.points[n].y * height,
  })) as Quad;
}
