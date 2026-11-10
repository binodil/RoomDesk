// The five surfaces of the room (back wall, side walls, floor, ceiling), each
// drawn as a flat HTML layer bent into perspective with a CSS matrix3d.
// Items live inside these layers, so they get the same perspective for free.

import { apply, invert, isConvex, rectToQuad, toMatrix3d, type Point, type Quad } from "./homography";
import { SURFACES, SURFACE_LABELS, surfaceQuad, type Calibration, type SurfaceName } from "./room";

/** Every surface is laid out as a flat area BASE units high; its width follows its shape. */
export const BASE = 1000;

/** Assumed room depth as a fraction of its width (only used for proportions). */
const ROOM_DEPTH = 0.8;

export const SURFACE_NAMES = Object.keys(SURFACES) as SurfaceName[];

export type SurfaceGeometry = {
  quad: Quad;
  /** Flat width in base units (height is always BASE). */
  width: number;
  /** Flat → screen (CSS pixels). Null when the shape is twisted. */
  toScreen: number[] | null;
  /** Screen → flat. */
  toFlat: number[] | null;
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export class Surfaces {
  readonly layer: HTMLDivElement;
  readonly els = {} as Record<SurfaceName, HTMLDivElement>;
  /** Where items of each surface are placed. */
  readonly itemLayers = {} as Record<SurfaceName, HTMLDivElement>;
  geometry = {} as Record<SurfaceName, SurfaceGeometry>;

  constructor(layer: HTMLDivElement) {
    this.layer = layer;
    for (const name of SURFACE_NAMES) {
      const el = document.createElement("div");
      el.className = `surface surface-${name}`;
      el.innerHTML = `<div class="grid"><span>${SURFACE_LABELS[name]}</span></div><div class="items"></div>`;
      layer.appendChild(el);
      this.els[name] = el;
      this.itemLayers[name] = el.querySelector(".items") as HTMLDivElement;
    }
  }

  /** Recompute every surface's shape from the calibration and the window size. */
  update(cal: Calibration): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Proportions of each surface, so items aren't stretched or squashed.
    // The back wall faces us, so its on-screen shape is its true shape. The other
    // surfaces are seen at an angle: their true depth is estimated by assuming the
    // room is about 0.8 times as deep as it is wide, then blended with the on-screen
    // shape so items there stay readable instead of fully foreshortened.
    const ratioOf = (q: Quad) =>
      (dist(q[0], q[1]) + dist(q[3], q[2])) / (dist(q[0], q[3]) + dist(q[1], q[2])) || 1;
    const backRatio = ratioOf(surfaceQuad(cal, "back", w, h));
    const estimate: Record<SurfaceName, number> = {
      back: backRatio,
      left: backRatio * ROOM_DEPTH,
      right: backRatio * ROOM_DEPTH,
      floor: 1 / ROOM_DEPTH,
      ceiling: 1 / ROOM_DEPTH,
    };
    for (const name of SURFACE_NAMES) {
      const quad = surfaceQuad(cal, name, w, h);
      const ratio = name === "back" ? backRatio : Math.sqrt(ratioOf(quad) * estimate[name]);
      const width = Math.round(BASE * Math.min(6, Math.max(0.2, ratio)));
      const toScreen = isConvex(quad) ? rectToQuad(width, BASE, quad) : null;
      const toFlat = toScreen ? invert(toScreen) : null;
      this.geometry[name] = { quad, width, toScreen, toFlat };

      const el = this.els[name];
      el.style.width = `${width}px`;
      el.style.height = `${BASE}px`;
      if (toScreen) {
        el.style.transform = toMatrix3d(toScreen);
        el.hidden = false;
      } else {
        el.hidden = true; // twisted shape: hide rather than draw nonsense
      }
    }
  }

  /** Which surface is under a screen point (CSS pixels), and where on it (base units).
   *  `prefer` is checked first so an item being dragged sticks to its surface at the edges. */
  hit(x: number, y: number, prefer?: SurfaceName): { surface: SurfaceName; x: number; y: number } | null {
    const order = prefer ? [prefer, ...SURFACE_NAMES.filter((n) => n !== prefer)] : SURFACE_NAMES;
    for (const name of order) {
      const g = this.geometry[name];
      if (!g?.toFlat) continue;
      const p = apply(g.toFlat, { x, y });
      if (p.x >= 0 && p.y >= 0 && p.x <= g.width && p.y <= BASE) return { surface: name, x: p.x, y: p.y };
    }
    return null;
  }

  /** Screen position (CSS pixels) of a flat point on a surface. */
  toScreen(surface: SurfaceName, p: Point): Point | null {
    const g = this.geometry[surface];
    return g?.toScreen ? apply(g.toScreen, p) : null;
  }

  setGridVisible(visible: boolean): void {
    this.layer.classList.toggle("no-grid", !visible);
  }

  highlight(surface: SurfaceName | null): void {
    for (const name of SURFACE_NAMES) this.els[name].classList.toggle("drop-target", name === surface);
  }
}
