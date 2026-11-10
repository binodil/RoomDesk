// Items in the room: app shortcuts, files and folders, plus notes, stickers,
// pictures, a clock, whiteboards, mirrors and things that age (see decor.ts).
//
// Each item sits on one surface at a position given in that surface's flat
// coordinates (0–1 across, 0–1 down), so it keeps its place when the
// calibration or the screen size changes.

import { invoke } from "@tauri-apps/api/core";
import { boardHtml, deleteBoard, loadBoard } from "./board";
import {
  CLOCK_HTML, DECOR_KINDS, FIREPLACE_HTML, SEA_VIEW, DECOR_SIZE, DIGITAL_CLOCK_HTML, NOTE_COLORS, STICKERS, appleSvg, daysSince, escapeHtml,
  hygrometerSvg, plantSvg, recycleSvg, roseSvg, stickerSvg, thermometerSvg, tickClocks, tickDigital, type DecorKind,
} from "./decor";
import { KINETIC_CLOCK_HTML, tickKinetic } from "./kinetic";
import type { SoundKind } from "./sound";
import { DEFAULT_VIDEO, drawMap, getReading, shortName, youtubeEmbed, type MapView, type Place } from "./live";
import { BASE, Surfaces } from "./surfaces";
import type { SurfaceName } from "./room";

export type FileKind = "folder" | "shortcut" | "app" | "file";
export type ItemKind = FileKind | DecorKind;

export type Item = {
  id: string;
  kind: ItemKind;
  surface: SurfaceName;
  /** Centre of the item, as fractions of the surface (0–1). */
  x: number;
  y: number;
  /** Width as a fraction of the surface height. */
  size: number;
  /** Files: what to open. Pictures: the image file. */
  path?: string;
  /** Files: the label under the icon. */
  name?: string;
  /** Notes. */
  text?: string;
  color?: string;
  /** Stickers. */
  glyph?: string;
  /** Plant: when planted. Rose and apple: when put there. */
  since?: number;
  /** Plant: when last watered. */
  watered?: number;
  /** Small tilt in degrees (notes and stickers). */
  rot?: number;
  /** Clock: "analog" (default), "digital" or "kinetic" (a wall of small clocks). */
  style?: "analog" | "digital" | "kinetic";
  /** Sensors: where the weather comes from. Map: where the pin is. */
  place?: Place;
  /** Thermometer: °C or °F. */
  unit?: "C" | "F";
  /** Map: the part of the map that is shown. */
  view?: MapView;
  /** Window: the YouTube link it plays (when it has no picture in `path`). */
  url?: string;
  /** Window and fireplace: the sound it makes. Window, fireplace and TV: how loud (0–1). */
  sound?: SoundKind | "none";
  volume?: number;
  /** TV: sound off. */
  muted?: boolean;
};

export type Layout = { version: 2; items: Item[] };

export type ItemInfo = { path: string; name: string; kind: ItemKind };

const DEFAULT_SIZE = 0.16;
const MIN_SIZE = 0.03;
const MAX_SIZE = 1.6;

const FILE_KINDS: FileKind[] = ["folder", "shortcut", "app", "file"];
export const isFile = (kind: ItemKind): kind is FileKind => (FILE_KINDS as string[]).includes(kind);
const KINDS: ItemKind[] = [...FILE_KINDS, ...DECOR_KINDS];

/** Items that do something when clicked behind the desktop icons. Others let clicks through to the desktop. */
const CLICKABLE: ItemKind[] = [
  "note", "whiteboard", "plant", "rose", "apple", "recycle", "thermometer", "hygrometer", "map", "window", "fireplace", "tv",
];
const SOUNDS = ["fire", "ocean", "wind", "rain", "none"];
export const isClickable = (kind: ItemKind) => isFile(kind) || CLICKABLE.includes(kind);
const SURFACES_OK = new Set(["back", "left", "right", "floor", "ceiling"]);

export function parseLayout(data: unknown): Layout {
  const items: Item[] = [];
  const list = (data as { items?: unknown })?.items;
  const version = Number((data as { version?: unknown })?.version) || 1;
  if (Array.isArray(list)) {
    for (const raw of list) {
      const r = raw as Partial<Item>;
      if (typeof r.id !== "string" || !SURFACES_OK.has(r.surface as string)) continue;
      let kind = KINDS.includes(r.kind as ItemKind) ? (r.kind as ItemKind) : "file";
      // Before version 2, a window without a picture played a YouTube video. That is a TV now.
      if (version < 2 && kind === "window" && typeof r.path !== "string") kind = "tv";
      if ((isFile(kind) || kind === "image") && typeof r.path !== "string") continue;
      const item: Item = {
        id: r.id,
        kind,
        surface: r.surface as SurfaceName,
        x: clamp01(Number(r.x)),
        y: clamp01(Number(r.y)),
        size: clampSize(Number(r.size) || DEFAULT_SIZE),
      };
      if (typeof r.path === "string") item.path = r.path;
      if (isFile(kind)) item.name = typeof r.name === "string" ? r.name : r.path;
      if (typeof r.text === "string") item.text = r.text;
      if (typeof r.color === "string") item.color = r.color;
      if (typeof r.glyph === "string") item.glyph = r.glyph;
      if (Number.isFinite(r.since)) item.since = r.since;
      if (Number.isFinite(r.watered)) item.watered = r.watered;
      if (Number.isFinite(r.rot)) item.rot = r.rot;
      if (r.style === "analog" || r.style === "digital" || r.style === "kinetic") item.style = r.style;
      if (r.unit === "C" || r.unit === "F") item.unit = r.unit;
      if (typeof r.url === "string") item.url = r.url;
      if (SOUNDS.includes(r.sound as string) && (kind === "window" || kind === "fireplace")) item.sound = r.sound;
      if (typeof r.muted === "boolean") item.muted = r.muted;
      if (Number.isFinite(r.volume)) item.volume = Math.min(1, Math.max(0, Number(r.volume)));
      const place = r.place as Partial<Place> | undefined;
      if (place && Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
        item.place = { name: String(place.name ?? ""), lat: Number(place.lat), lon: Number(place.lon) };
      }
      const view = r.view as Partial<MapView> | undefined;
      if (view && Number.isFinite(view.lat) && Number.isFinite(view.lon) && Number.isFinite(view.zoom)) {
        item.view = { lat: Number(view.lat), lon: Number(view.lon), zoom: Number(view.zoom) };
      }
      items.push(item);
    }
  }
  return { version: 2, items };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
const clampSize = (v: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, v));

// ---------- Icons ----------

const iconCache = new Map<string, Promise<string>>();

/** A plain placeholder while the real Windows icon loads (or if it can't be read). */
function placeholder(kind: FileKind): string {
  const color = { folder: "#e8b94a", shortcut: "#6fb1ff", app: "#6fb1ff", file: "#e9ecef" }[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="10" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function iconFor(path: string, kind: FileKind): Promise<string> {
  let p = iconCache.get(path);
  if (!p) {
    p = invoke<string>("item_icon", { path }).catch(() => placeholder(kind));
    iconCache.set(path, p);
  }
  return p;
}

const pictureCache = new Map<string, Promise<string | null>>();

function pictureFor(path: string): Promise<string | null> {
  let p = pictureCache.get(path);
  if (!p) {
    p = invoke<string>("load_image", { path }).catch(() => null);
    pictureCache.set(path, p);
  }
  return p;
}

/** The inside of an item's element, built once when it first appears. */
function buildItem(item: Item, el: HTMLDivElement): void {
  if (isFile(item.kind)) {
    const kind = item.kind;
    el.title = item.path ?? "";
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.src = placeholder(kind);
    void iconFor(item.path ?? "", kind).then((src) => (img.src = src));
    const label = document.createElement("div");
    label.className = "name";
    label.textContent = item.name ?? "";
    el.append(img, label);
    return;
  }
  switch (item.kind) {
    case "note":
      el.innerHTML = '<div class="notetext"></div>';
      break;
    case "image": {
      el.innerHTML = '<div class="pic"><img alt="" draggable="false"></div>';
      const img = el.querySelector("img") as HTMLImageElement;
      void pictureFor(item.path ?? "").then((src) => {
        if (src) img.src = src;
        else el.classList.add("missing");
      });
      break;
    }
    case "sticker":
      el.innerHTML = stickerSvg(item.glyph);
      break;
    case "recycle":
      el.innerHTML = '<div class="bin"></div><div class="name">Recycle Bin</div>';
      break;
    case "fireplace":
      el.innerHTML = FIREPLACE_HTML;
      break;
    case "whiteboard":
      el.innerHTML = '<div class="wbframe"><div class="wbsurf"></div></div><div class="wbledge"></div>';
      break;
    case "mirror":
      el.innerHTML = '<div class="mframe"><div class="mscene"></div><div class="mglass"></div></div>';
      break;
    default:
      break; // plant, rose, apple: drawn in updateItem
  }
}

/** The parts of an item that change: note text, age, and so on. */
function updateItem(item: Item, el: HTMLDivElement, now: number): void {
  switch (item.kind) {
    case "note": {
      el.style.setProperty("--note", item.color ?? NOTE_COLORS[0]);
      const t = el.querySelector(".notetext") as HTMLElement;
      if (t.textContent !== (item.text ?? "")) t.textContent = item.text ?? "";
      break;
    }
    case "plant":
      el.innerHTML = plantSvg(daysSince(item.since, now), daysSince(item.watered, now));
      break;
    case "rose":
      el.innerHTML = roseSvg(daysSince(item.since, now));
      break;
    case "apple":
      el.innerHTML = appleSvg(daysSince(item.since, now));
      break;
    case "whiteboard":
      void loadBoard(item.id).then((b) => {
        (el.querySelector(".wbsurf") as HTMLElement).innerHTML = boardHtml(b);
      });
      break;
    case "clock":
      el.innerHTML =
        item.style === "digital" ? DIGITAL_CLOCK_HTML : item.style === "kinetic" ? KINETIC_CLOCK_HTML : CLOCK_HTML;
      tickClocks(el);
      tickDigital(el);
      tickKinetic(el, Date.now(), true);
      break;
    case "recycle":
      (el.querySelector(".bin") as HTMLElement).innerHTML = recycleSvg(binItems);
      el.title = binItems ? `Recycle Bin: ${binItems} item${binItems === 1 ? "" : "s"}` : "Recycle Bin (empty)";
      break;
    case "thermometer":
    case "hygrometer": {
      const label = item.place ? shortName(item.place) : "Click to set";
      const draw = (temp: number | null, humidity: number | null) => {
        el.innerHTML = item.kind === "thermometer"
          ? thermometerSvg(temp === null ? null : temp, item.place ? `${label} ${temp === null ? "" : `${(item.unit === "F" ? temp * 1.8 + 32 : temp).toFixed(0)}°${item.unit ?? "C"}`}` : label)
          : hygrometerSvg(humidity, label);
      };
      draw(null, null);
      if (item.place) {
        void getReading(item.place).then((r) => {
          if (r) draw(r.temp, r.humidity);
        });
      }
      break;
    }
    case "map": {
      const place = item.place;
      const view = item.view ?? (place ? { lat: place.lat, lon: place.lon, zoom: 12 } : { lat: 30, lon: 20, zoom: 2 });
      el.innerHTML =
        '<div class="mapframe"><div class="mapwin"><div class="tiles"></div></div>' +
        `<div class="mapcap"><span>${escapeHtml(place ? shortName(place) : "Click to choose a place")}</span><span>© OpenStreetMap</span></div></div>`;
      drawMap(el.querySelector(".tiles") as HTMLElement, view, MAP_W, MAP_H, place);
      break;
    }
    case "window": {
      el.innerHTML =
        `<div class="winframe"><div class="glass">${item.path ? '<img class="outside" alt="" draggable="false">' : SEA_VIEW}</div>` +
        '<div class="mull"></div><div class="shine"></div></div><div class="sill"></div>';
      if (item.path) {
        const img = el.querySelector("img") as HTMLImageElement;
        void pictureFor(item.path).then((src) => {
          if (src) img.src = src;
        });
      }
      break;
    }
    case "tv": {
      // Starts with the sound it should have; later changes go through tvAudio().
      const src = youtubeEmbed(item.url ?? DEFAULT_VIDEO, { muted: tvMuted(item), controls: false, api: true });
      el.innerHTML =
        '<div class="tvset"><div class="screen">' +
        (src
          ? `<iframe src="${escapeHtml(src)}" title="TV" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" tabindex="-1"></iframe>`
          : '<div class="nosignal">No signal</div>') +
        '</div><div class="tvbar"><span class="led"></span></div></div>';
      const frame = el.querySelector("iframe");
      // The player needs a moment after loading before it listens; tell it a few times.
      frame?.addEventListener("load", () => [500, 2000, 5000].forEach((ms) => setTimeout(() => tvAudio(item, el), ms)));
      break;
    }
    default:
      break;
  }
}

/** While the TV is open big, the one on the wall stays quiet. */
let tvHushed = false;
/** While a game or full-screen app is open, TVs pause to save power. */
let tvResting = false;
const tvMuted = (item: Item) => !!item.muted || tvHushed || tvResting;

/** Tell a TV's YouTube player to match the item's sound settings. */
function tvAudio(item: Item, el: HTMLElement): void {
  const win = el.querySelector("iframe")?.contentWindow;
  if (!win) return;
  const send = (func: string, args: unknown[] = []) =>
    win.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube.com");
  if (tvMuted(item)) send("mute");
  else {
    send("unMute");
    send("setVolume", [Math.round((item.volume ?? 0.5) * 100)]);
  }
  send(tvResting ? "pauseVideo" : "playVideo");
}

/** The wall map is drawn at this size and then scaled to the item. */
const MAP_W = 480;
const MAP_H = 320;

/** Number of things in the Recycle Bin (updated from Windows every few seconds). */
let binItems = 0;

/** A key that changes whenever an item needs redrawing. */
function drawKey(item: Item, now: number): string {
  const aging = item.kind === "plant" || item.kind === "rose" || item.kind === "apple";
  return [
    item.text, item.color, item.since, item.watered, item.style, item.unit, item.url,
    item.kind === "window" ? item.path : "",
    item.kind === "tv" ? item.url ?? "" : "",
    item.place && `${item.place.lat},${item.place.lon},${item.place.name}`,
    item.view && `${item.view.lat},${item.view.lon},${item.view.zoom}`,
    item.kind === "recycle" ? binItems : "",
    aging ? Math.floor(now / 600000) : "",
  ].join("|");
}

// ---------- Drawing ----------

/** Things that stand upright when put on the floor, instead of lying flat on it. */
const STANDS: ItemKind[] = ["plant", "rose", "apple", "recycle", "fireplace"];
const standsUp = (item: Item) => item.surface === "floor" && STANDS.includes(item.kind);

export class Items {
  layout: Layout = { version: 2, items: [] };
  selectedId: string | null = null;
  private els = new Map<string, HTMLDivElement>();
  /** Screen-space layer for things standing on the floor. */
  private standing: HTMLDivElement;

  constructor(
    private surfaces: Surfaces,
    private onChange: () => void,
  ) {
    this.standing = document.createElement("div");
    this.standing.className = "standing";
    surfaces.layer.appendChild(this.standing);
  }

  find(id: string): Item | undefined {
    return this.layout.items.find((i) => i.id === id);
  }

  /** Create, move or remove item elements so they match the layout. */
  render(): void {
    const seen = new Set<string>();
    const now = Date.now();
    for (const item of this.layout.items) {
      seen.add(item.id);
      let el = this.els.get(item.id);
      if (!el || el.dataset.kind !== item.kind) {
        el?.remove();
        el = document.createElement("div");
        el.className = `item k-${item.kind}`;
        el.dataset.id = item.id;
        el.dataset.kind = item.kind;
        buildItem(item, el);
        this.els.set(item.id, el);
        el.dataset.version = "";
      }
      // Redraw the changing parts only when something about them changed.
      const version = drawKey(item, now);
      if (el.dataset.version !== version) {
        el.dataset.version = version;
        updateItem(item, el, now);
      }
      const width = this.surfaces.geometry[item.surface]?.width ?? BASE;
      const size = item.size * BASE;
      if (standsUp(item)) {
        this.placeStanding(item, el, width, size);
        el.classList.toggle("selected", item.id === this.selectedId);
        continue;
      }
      const layer = this.surfaces.itemLayers[item.surface];
      if (el.parentElement !== layer) layer.appendChild(el);
      el.style.zIndex = "";

      el.style.width = `${size}px`;
      el.style.setProperty("--label", `${Math.max(10, size * 0.16)}px`);
      el.style.setProperty("--s", `${size}px`);
      if (item.kind === "map") el.style.setProperty("--k", String((size * 0.94) / MAP_W));
      if (isFile(item.kind)) {
        // The icon (not the label below it) is centred on the item's position.
        el.style.left = `${item.x * width - size / 2}px`;
        el.style.top = `${item.y * BASE - size / 2}px`;
        el.style.transform = "";
      } else {
        el.style.left = `${item.x * width}px`;
        el.style.top = `${item.y * BASE}px`;
        el.style.transform = `translate(-50%, -50%) rotate(${item.rot ?? 0}deg)`;
        el.style.transformOrigin = "";
      }
      el.classList.toggle("selected", item.id === this.selectedId);
    }
    for (const [id, el] of this.els) {
      if (!seen.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
  }

  /** Draw an item upright on the floor: its bottom sits on the floor point, and it is
   *  scaled by how far away that point is, like a real object standing there. */
  private placeStanding(item: Item, el: HTMLDivElement, width: number, size: number): void {
    if (el.parentElement !== this.standing) this.standing.appendChild(el);
    const at = { x: item.x * width, y: item.y * BASE };
    const base = this.surfaces.toScreen("floor", at);
    const step = this.surfaces.toScreen("floor", { x: at.x + 10, y: at.y });
    if (!base || !step) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const scale = Math.hypot(step.x - base.x, step.y - base.y) / 10;
    el.style.width = `${size}px`;
    el.style.setProperty("--label", `${Math.max(10, size * 0.16)}px`);
    el.style.setProperty("--s", `${size}px`);
    el.style.left = `${base.x}px`;
    el.style.top = `${base.y}px`;
    el.style.transform = `translate(-50%, -100%) scale(${scale})`;
    el.style.transformOrigin = "50% 100%";
    // Nearer things (further down the floor) are drawn in front.
    el.style.zIndex = String(Math.round(item.y * 1000));
  }

  /** Redraw things that change with time (call every few minutes). */
  refreshAging(): void {
    const now = Date.now();
    for (const item of this.layout.items) {
      const el = this.els.get(item.id);
      if (el && (item.kind === "plant" || item.kind === "rose" || item.kind === "apple")) updateItem(item, el, now);
    }
  }

  /** Fresh weather for the sensors (call every 15 minutes or so). */
  refreshWeather(): void {
    const now = Date.now();
    for (const item of this.layout.items) {
      const el = this.els.get(item.id);
      if (el && (item.kind === "thermometer" || item.kind === "hygrometer")) updateItem(item, el, now);
    }
  }

  /** The sounds that should be playing now (item id → sound and volume). */
  sounds(): Map<string, { kind: SoundKind; volume: number }> {
    const out = new Map<string, { kind: SoundKind; volume: number }>();
    for (const item of this.layout.items) {
      if ((item.kind === "window" || item.kind === "fireplace") && item.sound && item.sound !== "none") {
        out.set(item.id, { kind: item.sound, volume: item.volume ?? 0.5 });
      }
    }
    return out;
  }

  /** Bring every TV's sound in line with its settings (cheap; call after changes). */
  syncTv(): void {
    for (const item of this.layout.items) {
      const el = this.els.get(item.id);
      if (el && item.kind === "tv") tvAudio(item, el);
    }
  }

  /** Pause the TVs while a game or full-screen app is open. */
  restTv(on: boolean): void {
    tvResting = on;
    this.syncTv();
  }

  /** Quiet the TVs on the wall while one is being watched big. */
  hushTv(on: boolean): void {
    tvHushed = on;
    this.syncTv();
  }

  get hasRecycleBin(): boolean {
    return this.layout.items.some((i) => i.kind === "recycle");
  }

  /** The Recycle Bin changed between empty and full (or its count changed). */
  setRecycleCount(count: number): void {
    if (count === binItems) return;
    binItems = count;
    this.render();
  }

  /** Show a whiteboard's latest drawing on the wall. */
  async refreshBoard(id: string): Promise<void> {
    const surf = this.els.get(id)?.querySelector<HTMLElement>(".wbsurf");
    if (surf) surf.innerHTML = boardHtml(await loadBoard(id));
  }

  element(id: string): HTMLDivElement | undefined {
    return this.els.get(id);
  }

  /** Screen rectangles of every clickable item (physical pixels), so clicks behind the icons can find them. */
  hitRegions(): { id: string; x: number; y: number; w: number; h: number }[] {
    const dpr = window.devicePixelRatio || 1;
    const out = [];
    for (const item of this.layout.items) {
      if (!isClickable(item.kind)) continue;
      const el = this.els.get(item.id);
      if (!el || el.hidden) continue;
      // The browser works out where the bent (perspective) element ends up on screen.
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      out.push({ id: item.id, x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr });
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
        kind: info.kind as FileKind,
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

  /** Add a note, sticker, clock, plant and so on. */
  addDecor(kind: DecorKind, surface: SurfaceName, x: number, y: number, extra: Partial<Item> = {}): Item {
    const now = Date.now();
    const item: Item = {
      id: crypto.randomUUID(),
      kind,
      surface,
      x: clamp01(x),
      y: clamp01(y),
      size: DECOR_SIZE[kind],
      ...extra,
    };
    if (kind === "note") {
      item.text ??= "";
      item.color ??= NOTE_COLORS[this.layout.items.filter((i) => i.kind === "note").length % NOTE_COLORS.length];
      item.rot ??= Math.round((Math.random() * 6 - 3) * 10) / 10;
    }
    if (kind === "sticker") {
      item.glyph ??= Object.keys(STICKERS)[0];
      item.rot ??= Math.round(Math.random() * 24 - 12);
    }
    if (kind === "plant" || kind === "rose" || kind === "apple") item.since = now;
    if (kind === "plant") item.watered = now;
    if (kind === "fireplace") item.sound ??= "fire";
    if (kind === "clock") item.style ??= "analog";
    if (kind === "tv") item.volume ??= 0.5;
    this.layout.items.push(item);
    this.selectedId = item.id;
    this.render();
    this.onChange();
    return item;
  }

  /** Change an item (note text, watering, a fresh rose...) and save. */
  update(id: string, changes: Partial<Item>): void {
    const item = this.find(id);
    if (!item) return;
    Object.assign(item, changes);
    this.render();
    this.onChange();
  }

  remove(id: string): void {
    if (this.find(id)?.kind === "whiteboard") deleteBoard(id);
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
