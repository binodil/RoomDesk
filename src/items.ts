// Desktop items in the room: app shortcuts, files and folders.
//
// Each item sits on one surface at a position given in that surface's flat
// coordinates (0–1 across, 0–1 down), so it keeps its place when the
// calibration or the screen size changes.

import { invoke } from "@tauri-apps/api/core";
import { BASE, Surfaces } from "./surfaces";
import type { SurfaceName } from "./room";

export type ItemKind = "folder" | "shortcut" | "app" | "file";

export type Item = {
  id: string;
  path: string;
  name: string;
  kind: ItemKind;
  surface: SurfaceName;
  /** Centre of the icon, as fractions of the surface (0–1). */
  x: number;
  y: number;
  /** Icon size as a fraction of the surface height. */
  size: number;
};

export type Layout = { version: 1; items: Item[] };

export type ItemInfo = { path: string; name: string; kind: ItemKind };

const DEFAULT_SIZE = 0.11;
const MIN_SIZE = 0.04;
const MAX_SIZE = 0.6;
/** The label under the icon makes an item about this much taller than wide. */
const LABEL_EXTRA = 0.5;

const KINDS: ItemKind[] = ["folder", "shortcut", "app", "file"];
const SURFACES_OK = new Set(["back", "left", "right", "floor", "ceiling"]);

export function parseLayout(data: unknown): Layout {
  const items: Item[] = [];
  const list = (data as { items?: unknown })?.items;
  if (Array.isArray(list)) {
    for (const raw of list) {
      const r = raw as Partial<Item>;
      if (typeof r.id !== "string" || typeof r.path !== "string" || !SURFACES_OK.has(r.surface as string)) continue;
      items.push({
        id: r.id,
        path: r.path,
        name: typeof r.name === "string" ? r.name : r.path,
        kind: KINDS.includes(r.kind as ItemKind) ? (r.kind as ItemKind) : "file",
        surface: r.surface as SurfaceName,
        x: clamp01(Number(r.x)),
        y: clamp01(Number(r.y)),
        size: clampSize(Number(r.size) || DEFAULT_SIZE),
      });
    }
  }
  return { version: 1, items };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
const clampSize = (v: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, v));

// ---------- Icons ----------

const iconCache = new Map<string, Promise<string>>();

/** A plain placeholder while the real Windows icon loads (or if it can't be read). */
function placeholder(kind: ItemKind): string {
  const color = { folder: "#e8b94a", shortcut: "#6fb1ff", app: "#6fb1ff", file: "#e9ecef" }[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="10" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function iconFor(item: Item): Promise<string> {
  let p = iconCache.get(item.path);
  if (!p) {
    p = invoke<string>("item_icon", { path: item.path }).catch(() => placeholder(item.kind));
    iconCache.set(item.path, p);
  }
  return p;
}

// ---------- Drawing ----------

export class Items {
  layout: Layout = { version: 1, items: [] };
  selectedId: string | null = null;
  private els = new Map<string, HTMLDivElement>();

  constructor(
    private surfaces: Surfaces,
    private onChange: () => void,
  ) {}

  find(id: string): Item | undefined {
    return this.layout.items.find((i) => i.id === id);
  }

  /** Create, move or remove item elements so they match the layout. */
  render(): void {
    const seen = new Set<string>();
    for (const item of this.layout.items) {
      seen.add(item.id);
      let el = this.els.get(item.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "item";
        el.dataset.id = item.id;
        el.title = item.path;
        const img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        img.src = placeholder(item.kind);
        void iconFor(item).then((src) => (img.src = src));
        const label = document.createElement("div");
        label.className = "name";
        label.textContent = item.name;
        el.append(img, label);
        this.els.set(item.id, el);
      }
      const layer = this.surfaces.itemLayers[item.surface];
      if (el.parentElement !== layer) layer.appendChild(el);

      const width = this.surfaces.geometry[item.surface]?.width ?? BASE;
      const size = item.size * BASE;
      el.style.width = `${size}px`;
      el.style.left = `${item.x * width - size / 2}px`;
      el.style.top = `${item.y * BASE - size / 2}px`;
      el.style.setProperty("--label", `${Math.max(10, size * 0.16)}px`);
      el.classList.toggle("selected", item.id === this.selectedId);
    }
    for (const [id, el] of this.els) {
      if (!seen.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
  }

  /** Screen rectangles of every item (physical pixels), so clicks behind the icons can find them. */
  hitRegions(): { id: string; x: number; y: number; w: number; h: number }[] {
    const dpr = window.devicePixelRatio || 1;
    const out = [];
    for (const item of this.layout.items) {
      const width = this.surfaces.geometry[item.surface]?.width ?? BASE;
      const size = item.size * BASE;
      const left = item.x * width - size / 2;
      const top = item.y * BASE - size / 2;
      const corners = [
        { x: left, y: top },
        { x: left + size, y: top },
        { x: left + size, y: top + size * (1 + LABEL_EXTRA) },
        { x: left, y: top + size * (1 + LABEL_EXTRA) },
      ]
        .map((p) => this.surfaces.toScreen(item.surface, p))
        .filter((p): p is { x: number; y: number } => p !== null);
      if (corners.length < 4) continue;
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      out.push({ id: item.id, x: x * dpr, y: y * dpr, w: (Math.max(...xs) - x) * dpr, h: (Math.max(...ys) - y) * dpr });
    }
    return out;
  }

  // ---------- Changes ----------

  add(infos: ItemInfo[], surface: SurfaceName, x: number, y: number): void {
    infos.forEach((info, i) => {
      const item: Item = {
        id: crypto.randomUUID(),
        path: info.path,
        name: info.name,
        kind: info.kind,
        surface,
        // Several files dropped at once are lined up side by side.
        x: clamp01(x + i * 0.08),
        y: clamp01(y),
        size: DEFAULT_SIZE,
      };
      this.layout.items.push(item);
      this.selectedId = item.id;
    });
    this.render();
    this.onChange();
  }

  remove(id: string): void {
    this.layout.items = this.layout.items.filter((i) => i.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.render();
    this.onChange();
  }

  resize(id: string, factor: number): void {
    const item = this.find(id);
    if (!item) return;
    item.size = clampSize(item.size * factor);
    this.render();
    this.onChange();
  }

  /** Put an item wherever the pointer is: on this surface, or another one it was dragged onto. */
  moveTo(id: string, screenX: number, screenY: number): void {
    const item = this.find(id);
    if (!item) return;
    const hit = this.surfaces.hit(screenX, screenY, item.surface);
    if (!hit) return;
    const width = this.surfaces.geometry[hit.surface].width;
    item.surface = hit.surface;
    item.x = clamp01(hit.x / width);
    item.y = clamp01(hit.y / BASE);
    this.render();
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.render();
  }
}
