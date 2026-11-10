// Zoomed-in panels for the sensors, the map and the video window. They share
// the dark overlay with the whiteboard and note editors.

import {
  DEFAULT_VIDEO, MAX_ZOOM, MIN_ZOOM, TILE, drawMap, getReading, project, searchPlaces, toUnit,
  unproject, youtubeEmbed, type MapView, type Place,
} from "./live";
import { invoke } from "@tauri-apps/api/core";
import { SEA_VIEW, escapeHtml } from "./decor";
import type { Item } from "./items";
import { SOUND_NAMES, type SoundKind } from "./sound";

type Changes = Partial<Item>;
export type PanelKind = "thermometer" | "hygrometer" | "map" | "window" | "tv";
const WINDOW_SOUNDS: SoundKind[] = ["ocean", "wind", "rain", "fire"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Panels {
  private overlay = $<HTMLDivElement>("focus");
  private panel = $<HTMLDivElement>("panel");
  private changes: Changes = {};
  private done: ((changes: Changes) => void) | null = null;
  /** Changes are shown in the room straight away (the sound starts, the wall map moves). */
  private live: ((changes: Changes) => void) | null = null;
  private cleanup: (() => void) | null = null;

  constructor() {
    this.overlay.addEventListener("pointerdown", (e) => {
      if (this.isOpen && e.target === this.overlay) this.close();
    });
    window.addEventListener("keydown", (e) => {
      if (this.isOpen && e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.done !== null;
  }

  open(item: Item, live: (changes: Changes) => void, done: (changes: Changes) => void): void {
    this.changes = {};
    this.done = done;
    this.live = live;
    this.overlay.dataset.kind = "panel";
    this.panel.dataset.kind = item.kind;
    if (item.kind === "map") this.buildMap(item);
    else if (item.kind === "window") this.buildWindow(item);
    else if (item.kind === "tv") this.buildTv(item);
    else this.buildSensor(item);
    this.overlay.hidden = false;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.panel.animate([{ transform: "scale(.4)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], {
        duration: 300,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    }
  }

  close(): void {
    const done = this.done;
    if (!done) return;
    this.done = null;
    this.cleanup?.();
    this.cleanup = null;
    this.overlay.hidden = true;
    this.panel.innerHTML = ""; // also stops a playing video
    this.live = null;
    done(this.changes);
  }

  private apply(changes: Changes): void {
    Object.assign(this.changes, changes);
    this.live?.(changes);
  }

  // ---------- Place search (sensors and map) ----------

  /** A search box that lists matching places and calls `pick` with the chosen one. */
  private placeSearch(host: HTMLElement, pick: (p: Place) => void): void {
    host.innerHTML = `
      <form class="search" role="search">
        <input type="search" placeholder="Search for a city or place…" aria-label="Search for a place" autocomplete="off">
        <button type="submit">Search</button>
      </form>
      <div class="results" role="listbox" hidden></div>`;
    const form = host.querySelector("form") as HTMLFormElement;
    const input = host.querySelector("input") as HTMLInputElement;
    const list = host.querySelector(".results") as HTMLDivElement;
    let found: Place[] = [];
    const run = async () => {
      list.hidden = false;
      list.innerHTML = '<div class="hint">Searching…</div>';
      try {
        found = await searchPlaces(input.value);
        list.innerHTML = found.length
          ? found.map((p, i) => `<button type="button" role="option" data-i="${i}">${escapeHtml(p.name)}</button>`).join("")
          : '<div class="hint">No places found.</div>';
      } catch {
        list.innerHTML = '<div class="hint">Could not search. Are you online?</div>';
      }
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void run();
    });
    list.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-i]");
      if (!b) return;
      pick(found[Number(b.dataset.i)]);
      list.hidden = true;
      input.value = "";
    });
    setTimeout(() => input.focus(), 50);
  }

  // ---------- Temperature and humidity ----------

  private buildSensor(item: Item): void {
    const isTemp = item.kind === "thermometer";
    let place = item.place;
    let unit = item.unit ?? "C";
    this.panel.innerHTML = `
      <h2>${isTemp ? "Temperature" : "Humidity"} outside</h2>
      <div class="reading" aria-live="polite"></div>
      <div class="where"></div>
      ${isTemp ? '<div class="units" role="group" aria-label="Unit"><button type="button" data-unit="C">°C</button><button type="button" data-unit="F">°F</button></div>' : ""}
      <div class="placesearch"></div>
      <p class="note">From Open-Meteo, updated every 15 minutes. Your PC has no thermometer, so this is the weather where you choose.</p>
      <div class="actions"><button type="button" class="primary" data-act="done">Done</button></div>`;
    const reading = this.panel.querySelector(".reading") as HTMLElement;
    const where = this.panel.querySelector(".where") as HTMLElement;
    const show = async () => {
      where.textContent = place ? place.name : "Choose a place below to start.";
      this.panel.querySelectorAll<HTMLButtonElement>("[data-unit]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.unit === unit)));
      if (!place) {
        reading.textContent = "—";
        return;
      }
      reading.textContent = "…";
      const r = await getReading(place);
      if (!r) reading.textContent = "Offline";
      else reading.textContent = isTemp ? `${toUnit(r.temp, unit).toFixed(1)} °${unit}` : `${Math.round(r.humidity)} %`;
    };
    this.placeSearch(this.panel.querySelector(".placesearch") as HTMLElement, (p) => {
      place = p;
      this.apply({ place: p });
      void show();
    });
    this.panel.querySelector(".units")?.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-unit]");
      if (!b) return;
      unit = b.dataset.unit as "C" | "F";
      this.apply({ unit });
      void show();
    });
    this.panel.querySelector('[data-act="done"]')?.addEventListener("click", () => this.close());
    void show();
  }

  // ---------- Map ----------

  private buildMap(item: Item): void {
    let pin = item.place;
    const view: MapView = { ...(item.view ?? (pin ? { lat: pin.lat, lon: pin.lon, zoom: 12 } : { lat: 30, lon: 20, zoom: 2 })) };
    this.panel.innerHTML = `
      <div class="maptop"><div class="placesearch"></div>
        <button type="button" data-act="pin" title="Put the pin in the middle of the map">Pin here</button>
        <button type="button" data-act="zin" aria-label="Zoom in">+</button>
        <button type="button" data-act="zout" aria-label="Zoom out">−</button>
        <button type="button" class="primary" data-act="done">Done</button></div>
      <div class="bigmap" tabindex="0" aria-label="Map. Drag to move, scroll to zoom."><div class="tiles"></div>
        <div class="attrib">© OpenStreetMap contributors</div></div>`;
    const box = this.panel.querySelector(".bigmap") as HTMLDivElement;
    const tiles = box.querySelector(".tiles") as HTMLDivElement;
    const redraw = () => {
      // Keep fractional zoom out of the tiles: they are drawn at whole zoom levels.
      view.zoom = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom)));
      drawMap(tiles, view, box.clientWidth, box.clientHeight, pin);
      this.changes.view = { ...view };
    };
    const zoomAt = (dz: number, cx = box.clientWidth / 2, cy = box.clientHeight / 2) => {
      const z = Math.round(view.zoom);
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + dz));
      if (nz === z) return;
      // Keep the point under the mouse where it is.
      const c = project(view.lat, view.lon, z);
      const px = c.x - box.clientWidth / 2 + cx;
      const py = c.y - box.clientHeight / 2 + cy;
      const k = 2 ** (nz - z);
      const nc = { x: px * k - cx + box.clientWidth / 2, y: py * k - cy + box.clientHeight / 2 };
      const ll = unproject(nc.x, nc.y, nz);
      Object.assign(view, { lat: ll.lat, lon: ll.lon, zoom: nz });
      redraw();
    };
    let drag: { x: number; y: number; cx: number; cy: number; id: number } | null = null;
    box.addEventListener("pointerdown", (e) => {
      const c = project(view.lat, view.lon, Math.round(view.zoom));
      drag = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y, id: e.pointerId };
      box.setPointerCapture(e.pointerId);
      box.classList.add("dragging");
    });
    box.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const ll = unproject(drag.cx - (e.clientX - drag.x), drag.cy - (e.clientY - drag.y), Math.round(view.zoom));
      view.lat = Math.max(-84, Math.min(84, ll.lat));
      view.lon = ll.lon;
      redraw();
    });
    const end = () => {
      drag = null;
      box.classList.remove("dragging");
    };
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
    box.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = box.getBoundingClientRect();
        zoomAt(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    box.addEventListener("keydown", (e) => {
      const step = TILE / 2;
      const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (move[e.key]) {
        e.preventDefault();
        const z = Math.round(view.zoom);
        const c = project(view.lat, view.lon, z);
        const ll = unproject(c.x + move[e.key][0], c.y + move[e.key][1], z);
        Object.assign(view, { lat: ll.lat, lon: ll.lon });
        redraw();
      }
      if (e.key === "+" || e.key === "=") zoomAt(1);
      if (e.key === "-") zoomAt(-1);
    });
    this.placeSearch(this.panel.querySelector(".placesearch") as HTMLElement, (p) => {
      pin = p;
      this.apply({ place: p });
      Object.assign(view, { lat: p.lat, lon: p.lon, zoom: 12 });
      redraw();
    });
    this.panel.querySelector(".maptop")?.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]")?.dataset.act;
      if (act === "done") this.close();
      if (act === "zin") zoomAt(1);
      if (act === "zout") zoomAt(-1);
      if (act === "pin") {
        pin = { name: pin?.name ?? "Pinned place", lat: view.lat, lon: view.lon };
        this.apply({ place: pin });
        redraw();
      }
    });
    const ro = new ResizeObserver(redraw);
    ro.observe(box);
    this.cleanup = () => ro.disconnect();
    requestAnimationFrame(redraw);
  }

  // ---------- Video window ----------

  private buildWindow(item: Item): void {
    let picture = item.path;
    let sound = item.sound ?? "none";
    let volume = item.volume ?? 0.5;
    this.panel.innerHTML = `
      <div class="player"></div>
      <div class="row">
        <span class="label">Outside</span>
        <button type="button" data-act="picture">Your picture…</button>
        <button type="button" data-act="sea">Sea at dusk</button>
      </div>
      <div class="row" role="group" aria-label="Sound outside the window">
        <span class="label">Sound</span>
        <button type="button" data-sound="none">None</button>
        ${WINDOW_SOUNDS.map((k) => `<button type="button" data-sound="${k}">${SOUND_NAMES[k]}</button>`).join("")}
        <input type="range" min="0" max="1" step="0.05" aria-label="Volume">
      </div>
      <div class="row end"><span class="note">Tip: a photo of a beach, forest or cabin with a matching sound makes a calm view.</span>
        <button type="button" class="primary" data-act="done">Done</button></div>`;
    const player = this.panel.querySelector(".player") as HTMLDivElement;
    const range = this.panel.querySelector('input[type="range"]') as HTMLInputElement;
    const show = async () => {
      if (!picture) {
        player.innerHTML = SEA_VIEW;
        return;
      }
      const src = await invoke<string>("load_image", { path: picture }).catch(() => null);
      player.innerHTML = src ? `<img src="${src}" alt="">` : '<div class="hint">Could not open that picture.</div>';
    };
    const showSound = () => {
      this.panel.querySelectorAll<HTMLButtonElement>("[data-sound]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sound === sound)));
      range.value = String(volume);
      range.disabled = sound === "none";
    };
    void show();
    showSound();
    this.panel.addEventListener("click", async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.dataset.act === "done") this.close();
      if (b.dataset.act === "sea") {
        picture = undefined;
        this.apply({ path: undefined });
        void show();
      }
      if (b.dataset.act === "picture") {
        const path = await invoke<string | null>("pick_image").catch(() => null);
        if (!path) return;
        picture = path;
        this.apply({ path });
        void show();
      }
      if (b.dataset.sound) {
        sound = b.dataset.sound as SoundKind | "none";
        this.apply({ sound, volume });
        showSound();
      }
    });
    range.addEventListener("input", () => {
      volume = Number(range.value);
      this.apply({ volume });
    });
  }

  // ---------- TV ----------

  private buildTv(item: Item): void {
    let link = item.url ?? DEFAULT_VIDEO;
    let muted = !!item.muted;
    let volume = item.volume ?? 0.5;
    this.panel.innerHTML = `
      <div class="player"></div>
      <div class="row">
        <span class="label">Channel</span>
        <button type="button" data-act="iss">Space station (live)</button>
        <form class="videolink"><input type="url" aria-label="YouTube link" placeholder="or paste any YouTube link: a video or a live stream">
          <button type="submit">Watch</button></form>
      </div>
      <div class="row" role="group" aria-label="Sound of the TV on the wall">
        <span class="label">On the wall</span>
        <button type="button" data-muted="false">Sound on</button>
        <button type="button" data-muted="true">Sound off</button>
        <input type="range" min="0" max="1" step="0.05" aria-label="Volume on the wall">
      </div>
      <div class="row end"><span class="note">While this is open, the TV on the wall is quiet so you only hear this one.</span>
        <button type="button" class="primary" data-act="done">Done</button></div>`;
    const player = this.panel.querySelector(".player") as HTMLDivElement;
    const input = this.panel.querySelector('input[type="url"]') as HTMLInputElement;
    const range = this.panel.querySelector('input[type="range"]') as HTMLInputElement;
    const show = () => {
      const src = youtubeEmbed(link, { muted: false, controls: true });
      player.innerHTML = src
        ? `<iframe src="${escapeHtml(src)}" title="TV" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
        : '<div class="hint">That doesn\'t look like a YouTube link.</div>';
    };
    const showSound = () => {
      this.panel.querySelectorAll<HTMLButtonElement>("[data-muted]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.muted === String(muted))));
      range.value = String(volume);
      range.disabled = muted;
    };
    input.value = item.url && item.url !== DEFAULT_VIDEO ? item.url : "";
    show();
    showSound();
    this.panel.querySelector("form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!youtubeEmbed(input.value, { muted: true, controls: false })) {
        player.innerHTML = '<div class="hint">That doesn\'t look like a YouTube link.</div>';
        return;
      }
      link = input.value.trim();
      this.apply({ url: link });
      show();
    });
    this.panel.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.dataset.act === "done") this.close();
      if (b.dataset.act === "iss") {
        link = DEFAULT_VIDEO;
        input.value = "";
        this.apply({ url: DEFAULT_VIDEO });
        show();
      }
      if (b.dataset.muted) {
        muted = b.dataset.muted === "true";
        this.apply({ muted });
        showSound();
      }
    });
    range.addEventListener("input", () => {
      volume = Number(range.value);
      this.apply({ volume });
    });
  }
}
