// Things in the room that come from the internet: the weather (for the
// temperature and humidity sensors), map tiles, and YouTube videos for the
// window. All free services that need no account or key:
//   * Open-Meteo for place search and the current weather
//   * OpenStreetMap for map tiles
//   * YouTube's embedded player

export type Place = { name: string; lat: number; lon: number };
export type MapView = { lat: number; lon: number; zoom: number };
export type Reading = { temp: number; humidity: number; time: number };

// ---------- Place search ----------

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`place search failed (${res.status})`);
  const data = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[];
  };
  return (data.results ?? []).map((r) => ({
    name: [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : null, r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/** "Tashkent, Uzbekistan" → "Tashkent", for small labels. */
export const shortName = (p: Place | undefined) => (p?.name ?? "").split(",")[0];

// ---------- Weather ----------

const WEATHER_MAX_AGE = 15 * 60 * 1000;
const readings = new Map<string, Promise<Reading | null>>();
const readingTimes = new Map<string, number>();

/** Current outdoor temperature (°C) and humidity (%) at a place, fetched at most every 15 minutes. */
export function getReading(place: Place): Promise<Reading | null> {
  const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
  const fetched = readingTimes.get(key) ?? 0;
  let p = readings.get(key);
  if (!p || Date.now() - fetched > WEATHER_MAX_AGE) {
    readingTimes.set(key, Date.now());
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      "&current=temperature_2m,relative_humidity_2m";
    const previous = p;
    p = fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { current?: { temperature_2m?: number; relative_humidity_2m?: number } }) => {
        const t = d.current?.temperature_2m;
        const h = d.current?.relative_humidity_2m;
        return typeof t === "number" && typeof h === "number" ? { temp: t, humidity: h, time: Date.now() } : null;
      })
      .catch(async () => {
        // Offline for a moment: keep showing the last reading, and try again sooner.
        readingTimes.set(key, Date.now() - WEATHER_MAX_AGE + 60 * 1000);
        return (await previous) ?? null;
      });
    readings.set(key, p);
  }
  return p;
}

export const toUnit = (c: number, unit: "C" | "F" | undefined) => (unit === "F" ? c * 1.8 + 32 : c);

// ---------- Map tiles (OpenStreetMap) ----------

export const TILE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 18;

/** Position of a place in "world pixels" at a zoom level. */
export function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

export function unproject(x: number, y: number, zoom: number): { lat: number; lon: number } {
  const scale = TILE * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
}

/**
 * Fill `container` (w × h CSS pixels) with the map tiles for `view`, with a pin
 * on `pin`. Tiles already there are reused, so this is cheap to call while dragging.
 */
export function drawMap(container: HTMLElement, view: MapView, w: number, h: number, pin?: Place): void {
  const z = Math.round(view.zoom);
  const n = 2 ** z;
  const c = project(view.lat, view.lon, z);
  const left = c.x - w / 2;
  const top = c.y - h / 2;
  const keep = new Set<string>();
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
      const wx = ((tx % n) + n) % n; // the world repeats left and right
      const key = `${z}/${tx}/${ty}`;
      keep.add(key);
      let img = container.querySelector<HTMLImageElement>(`img[data-tile="${key}"]`);
      if (!img) {
        img = document.createElement("img");
        img.className = "tile";
        img.alt = "";
        img.draggable = false;
        img.dataset.tile = key;
        img.referrerPolicy = "strict-origin-when-cross-origin";
        img.src = `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`;
        container.prepend(img);
      }
      img.style.left = `${tx * TILE - left}px`;
      img.style.top = `${ty * TILE - top}px`;
    }
  }
  container.querySelectorAll<HTMLImageElement>("img.tile").forEach((img) => {
    if (!keep.has(img.dataset.tile ?? "")) img.remove();
  });
  let marker = container.querySelector<HTMLElement>(".pin");
  if (pin) {
    if (!marker) {
      marker = document.createElement("div");
      marker.className = "pin";
      marker.innerHTML =
        '<svg viewBox="0 0 24 34"><path d="M12 1C6 1 1.5 5.5 1.5 11.3 1.5 19 12 33 12 33s10.5-14 10.5-21.7C22.5 5.5 18 1 12 1z" fill="#d6453d" stroke="#fff" stroke-width="2"/><circle cx="12" cy="11.5" r="4" fill="#fff"/></svg>';
      container.appendChild(marker);
    }
    const p = project(pin.lat, pin.lon, z);
    // Draw the pin on the copy of the world nearest the centre.
    const world = TILE * n;
    const px = p.x + Math.round((c.x - p.x) / world) * world;
    marker.style.left = `${px - left}px`;
    marker.style.top = `${p.y - top}px`;
  } else {
    marker?.remove();
  }
}

// ---------- YouTube ----------

/** NASA's live view of Earth from the International Space Station. */
export const DEFAULT_VIDEO = "https://www.youtube.com/watch?v=21X5lGlDOfg";

/** The YouTube embed address for a link someone pasted, or null if it isn't a YouTube link. */
export function youtubeEmbed(link: string, opts: { muted: boolean; controls: boolean; api?: boolean }): string | null {
  const s = link.trim();
  let path: string | null = null;
  const id = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (id) path = `embed/${id[1]}`;
  const channel = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (!path && channel) path = `embed/live_stream?channel=${channel[1]}`;
  if (!path) return null;
  const params = new URLSearchParams({
    autoplay: "1",
    mute: opts.muted ? "1" : "0",
    controls: opts.controls ? "1" : "0",
    // Lets the room turn the sound on and off without reloading the video.
    ...(opts.api ? { enablejsapi: "1", origin: window.location.origin } : {}),
    playsinline: "1",
    rel: "0",
  });
  return `https://www.youtube.com/${path}${path.includes("?") ? "&" : "?"}${params}`;
}
