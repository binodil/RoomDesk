import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { availableMonitors, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { FocusEditor } from "./board";
import { STICKERS, stickerSvg, tickClocks, tickDigital, type DecorKind } from "./decor";
import { Items, isFile, parseLayout, type Item, type ItemInfo } from "./items";
import { refreshMirrors } from "./mirror";
import { BIN_NAME } from "./platform";
import { Panels } from "./panels";
import { setResting, syncSounds } from "./sound";
import { POINT_NAMES, defaultCalibration, parseCalibration, type Calibration, type PointName } from "./room";
import { BASE, SURFACE_NAMES, Surfaces } from "./surfaces";

// One of these pages runs on each monitor, behind your desktop icons.
// Modes (switched from the tray):
//   use       – behind the icons; clicking an item opens it
//   edit      – in front; drag files in, move, resize and remove items
//   calibrate – in front; drag the room's corners onto the photo
//   focus     – in front; one whiteboard or note zoomed in to draw or type on

type Mode = "use" | "edit" | "calibrate" | "focus";

const SAMPLE_ROOM = "/default-room.jpg";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const photo = $<HTMLDivElement>("photo");
const editor = $<HTMLDivElement>("editor");
const editbar = $<HTMLDivElement>("editbar");
const outlines = document.getElementById("outlines") as unknown as SVGSVGElement;
const handlesLayer = $<HTMLDivElement>("handles");
const removeBtn = $<HTMLButtonElement>("editRemove");

const surfaces = new Surfaces($<HTMLDivElement>("surfaces"));
const items = new Items(surfaces, () => {
  saveLayoutSoon();
  updateRemoveButton();
  refreshMirrorsSoon();
  syncSounds(items.sounds());
  items.syncTv();
});
const focusEditor = new FocusEditor();
const panels = new Panels();
const PANEL_KINDS = new Set(["thermometer", "hygrometer", "map", "window", "tv"]);

let calibration: Calibration = defaultCalibration();
let monitorKey = "";
let monitorIndex = 0;
let mode: Mode = "use";
let showGrid = true;

// ---------- Photo ----------

async function showPhoto(): Promise<void> {
  let url = SAMPLE_ROOM;
  try {
    url = (await invoke<string | null>("load_photo")) ?? SAMPLE_ROOM;
  } catch (err) {
    console.error("Could not load the room photo:", err);
  }
  photo.style.backgroundImage = `url("${url}")`;
  refreshMirrorsSoon();
}

// ---------- Per-monitor data (calibration and items) ----------

async function findMonitor(): Promise<void> {
  const m = await currentMonitor();
  monitorKey = m ? `${m.name ?? "monitor"}|${m.size.width}x${m.size.height}` : "unknown";
  monitorIndex = Number(getCurrentWindow().label.replace("room-", "")) || 0;
  const total = (await availableMonitors()).length;
  $("calTitle").textContent = `Calibrate monitor ${monitorIndex + 1} of ${total}`;
  $("editTitle").textContent = `Edit items on monitor ${monitorIndex + 1} of ${total}`;
}

async function loadMonitorData(): Promise<void> {
  try {
    calibration = parseCalibration(await invoke("load_calibration", { monitor: monitorKey }));
  } catch {
    calibration = defaultCalibration();
  }
  try {
    items.layout = parseLayout(await invoke("load_layout", { monitor: monitorKey }));
  } catch {
    items.layout = parseLayout(null);
  }
}

function debounce(fn: () => void, ms: number): () => void {
  let t: number | undefined;
  return () => {
    window.clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}

const saveCalibrationSoon = debounce(() => {
  invoke("save_calibration", { monitor: monitorKey, calibration }).catch((e) => console.error(e));
}, 250);

const saveLayoutSoon = debounce(() => {
  invoke("save_layout", { monitor: monitorKey, layout: items.layout }).catch((e) => console.error(e));
  sendHitRegionsSoon();
}, 300);

const refreshMirrorsSoon = debounce(() => refreshMirrors(items, surfaces, photo.style.backgroundImage), 250);

const sendHitRegionsSoon = debounce(() => {
  invoke("set_hit_regions", { regions: items.hitRegions() }).catch((e) => console.error(e));
}, 100);

// ---------- Drawing ----------

const handleEls = {} as Record<PointName, HTMLButtonElement>;
for (const name of POINT_NAMES) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `handle ${name.startsWith("back") ? "inner" : "outer"}`;
  el.setAttribute("aria-label", `Corner point ${name}`);
  el.dataset.point = name;
  handlesLayer.appendChild(el);
  handleEls[name] = el;
}

function render(): void {
  surfaces.update(calibration);
  surfaces.setGridVisible(showGrid || mode === "calibrate");
  items.render();
  sendHitRegionsSoon();
  refreshMirrorsSoon();
  syncSounds(items.sounds());

  if (mode === "calibrate") {
    const w = window.innerWidth;
    const h = window.innerHeight;
    outlines.setAttribute("viewBox", `0 0 ${w} ${h}`);
    outlines.innerHTML = SURFACE_NAMES.map((name) => {
      const g = surfaces.geometry[name];
      const pts = g.quad.map((p) => `${p.x},${p.y}`).join(" ");
      return `<polygon class="${g.toScreen ? "" : "bad"}" points="${pts}"/>`;
    }).join("");
    for (const name of POINT_NAMES) {
      const p = calibration.points[name];
      handleEls[name].style.left = `${p.x * w}px`;
      handleEls[name].style.top = `${p.y * h}px`;
    }
  }
}

function setMode(next: Mode): void {
  if (next !== "focus" && (focusEditor.isOpen || panels.isOpen)) {
    // Switched from the tray while something was zoomed in: save it and move on.
    mode = next;
    focusEditor.close();
    panels.close();
  }
  closeAddMenu();
  mode = next;
  document.body.dataset.mode = next;
  editor.hidden = next !== "calibrate";
  editbar.hidden = next !== "edit";
  if (next !== "edit") items.select(null);
  updateRemoveButton();
  render();
}

function updateRemoveButton(): void {
  removeBtn.disabled = !items.selectedId;
}

// ---------- Calibrate mode: dragging the corner points ----------

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

let draggingPoint: { name: PointName; id: number } | null = null;
handlesLayer.addEventListener("pointerdown", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".handle");
  if (!target) return;
  e.preventDefault();
  target.focus();
  target.setPointerCapture(e.pointerId);
  draggingPoint = { name: target.dataset.point as PointName, id: e.pointerId };
  target.classList.add("active");
});
handlesLayer.addEventListener("pointermove", (e) => {
  if (!draggingPoint || e.pointerId !== draggingPoint.id) return;
  calibration.points[draggingPoint.name] = {
    x: clamp01(e.clientX / window.innerWidth),
    y: clamp01(e.clientY / window.innerHeight),
  };
  render();
});
const endPointDrag = (e: PointerEvent) => {
  if (!draggingPoint || e.pointerId !== draggingPoint.id) return;
  handleEls[draggingPoint.name].classList.remove("active");
  draggingPoint = null;
  saveCalibrationSoon();
};
handlesLayer.addEventListener("pointerup", endPointDrag);
handlesLayer.addEventListener("pointercancel", endPointDrag);

handlesLayer.addEventListener("keydown", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".handle");
  if (!target) return;
  const step = e.shiftKey ? 10 : 1;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  const name = target.dataset.point as PointName;
  const p = calibration.points[name];
  calibration.points[name] = {
    x: clamp01(p.x + d[0] / window.innerWidth),
    y: clamp01(p.y + d[1] / window.innerHeight),
  };
  render();
  saveCalibrationSoon();
});

$("calReset").addEventListener("click", () => {
  calibration = defaultCalibration();
  render();
  saveCalibrationSoon();
});
$("calFinish").addEventListener("click", () => void invoke("finish_front_mode"));

// ---------- Edit mode: moving, resizing and removing items ----------

let draggingItem: { id: string; pointer: number; moved: boolean } | null = null;

document.addEventListener("pointerdown", (e) => {
  if (mode !== "edit") return;
  const el = (e.target as HTMLElement).closest<HTMLElement>(".item");
  if ((e.target as HTMLElement).closest(".toolbar, #focus")) return;
  closeAddMenu();
  if (!el) {
    items.select(null);
    updateRemoveButton();
    return;
  }
  e.preventDefault();
  items.select(el.dataset.id ?? null);
  updateRemoveButton();
  draggingItem = { id: el.dataset.id ?? "", pointer: e.pointerId, moved: false };
});
window.addEventListener("pointermove", (e) => {
  if (!draggingItem || e.pointerId !== draggingItem.pointer) return;
  draggingItem.moved = true;
  items.moveTo(draggingItem.id, e.clientX, e.clientY);
});
const endItemDrag = (e: PointerEvent) => {
  if (!draggingItem || e.pointerId !== draggingItem.pointer) return;
  if (draggingItem.moved) saveLayoutSoon();
  draggingItem = null;
};
window.addEventListener("pointerup", endItemDrag);
window.addEventListener("pointercancel", endItemDrag);

// Scroll over an item to resize it.
document.addEventListener(
  "wheel",
  (e) => {
    if (mode !== "edit" || (e.target as HTMLElement).closest(".toolbar")) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>(".item");
    const id = el?.dataset.id ?? items.selectedId;
    if (!id) return;
    e.preventDefault();
    items.select(id);
    items.resize(id, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  },
  { passive: false },
);

$("editAdd").addEventListener("click", async () => {
  closeAddMenu();
  const picked = await invoke<ItemInfo[]>("pick_items").catch(() => []);
  if (picked.length) items.add(picked, "back", 0.2, 0.45);
  updateRemoveButton();
});

// "Add item" menu: notes, pictures, whiteboard, mirror, clock, plant, rose, apple, stickers.
const addMenu = $<HTMLDivElement>("addMenu");
const addMenuBtn = $<HTMLButtonElement>("addMenuBtn");
// "Recycle Bin" on Windows, "Trash" on a Mac.
addMenu.querySelectorAll(".binname").forEach((el) => (el.textContent = BIN_NAME));
$("stickerRow").innerHTML = Object.keys(STICKERS)
  .map((g) => `<button type="button" role="menuitem" data-add="sticker" data-glyph="${g}" aria-label="${g} sticker">${stickerSvg(g)}</button>`)
  .join("");

function closeAddMenu(): void {
  addMenu.hidden = true;
  addMenuBtn.setAttribute("aria-expanded", "false");
}
addMenuBtn.addEventListener("click", () => {
  addMenu.hidden = !addMenu.hidden;
  addMenuBtn.setAttribute("aria-expanded", String(!addMenu.hidden));
});

/** Where new things appear: spread over the back wall so they don't all stack up. */
const START_SPOTS: Record<DecorKind, [number, number]> = {
  note: [0.2, 0.3],
  sticker: [0.5, 0.2],
  image: [0.75, 0.35],
  clock: [0.5, 0.18],
  plant: [0.88, 0.78],
  rose: [0.62, 0.7],
  apple: [0.7, 0.8],
  whiteboard: [0.45, 0.42],
  mirror: [0.8, 0.45],
  recycle: [0.08, 0.85],
  thermometer: [0.3, 0.3],
  hygrometer: [0.36, 0.3],
  map: [0.25, 0.4],
  window: [0.6, 0.38],
  fireplace: [0.5, 0.8],
  tv: [0.5, 0.42],
};

addMenu.addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-add]");
  if (!b) return;
  const kind = b.dataset.add as DecorKind;
  closeAddMenu();
  const nudge = (items.layout.items.filter((i) => i.kind === kind).length % 5) * 0.04;
  const [x, y] = START_SPOTS[kind];
  if (kind === "image") {
    const path = await invoke<string | null>("pick_image").catch(() => null);
    if (path) items.addDecor("image", "back", x - nudge, y + nudge, { path });
  } else {
    const extra: Partial<Item> = {};
    if (kind === "sticker") extra.glyph = b.dataset.glyph;
    if (kind === "clock") extra.style = b.dataset.style === "digital" ? "digital" : "analog";
    // Sensors and maps start at the place already used by another one.
    const known = items.layout.items.find((i) => i.place)?.place;
    if (known && (kind === "thermometer" || kind === "hygrometer" || kind === "map")) extra.place = known;
    const item = items.addDecor(kind, "back", x + nudge, y + nudge, extra);
    if (kind === "note" || ((kind === "thermometer" || kind === "hygrometer" || kind === "map") && !known)) openFocus(item.id);
  }
  updateRemoveButton();
});

// Double-click while editing: write on a note or whiteboard, set up a sensor,
// map or window, switch a clock between analog and digital.
document.addEventListener("dblclick", (e) => {
  if (mode !== "edit") return;
  const id = (e.target as HTMLElement).closest<HTMLElement>(".item")?.dataset.id;
  const item = id ? items.find(id) : undefined;
  if (!item) return;
  if (item.kind === "clock") items.update(item.id, { style: item.style === "digital" ? "analog" : "digital" });
  else if (item.kind === "fireplace") toggleFire(item);
  else openFocus(item.id);
});
removeBtn.addEventListener("click", () => {
  if (items.selectedId) items.remove(items.selectedId);
});
$("editDone").addEventListener("click", () => void invoke("finish_front_mode"));

window.addEventListener("keydown", (e) => {
  // Keys handled by the whiteboard or note (or typed into them) are not for us.
  if (e.defaultPrevented || focusEditor.isOpen || panels.isOpen) return;
  if (e.key === "Escape" && !addMenu.hidden) {
    closeAddMenu();
    return;
  }
  if (e.key === "Escape" && mode !== "use") void invoke("finish_front_mode");
  if ((e.key === "Delete" || e.key === "Backspace") && mode === "edit" && items.selectedId) {
    items.remove(items.selectedId);
  }
});

// Files dragged in from File Explorer (only possible while the room is in front).
async function wireFileDrop(): Promise<void> {
  await getCurrentWebview().onDragDropEvent(async (event) => {
    const p = event.payload;
    if (mode !== "edit") {
      surfaces.highlight(null);
      return;
    }
    if (p.type === "leave") {
      surfaces.highlight(null);
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const x = p.position.x / dpr;
    const y = p.position.y / dpr;
    const hit = surfaces.hit(x, y);
    if (p.type === "over" || p.type === "enter") {
      surfaces.highlight(hit?.surface ?? null);
      return;
    }
    if (p.type === "drop") {
      surfaces.highlight(null);
      const infos = await invoke<ItemInfo[]>("describe_paths", { paths: p.paths });
      if (!infos.length) return;
      const where = hit ?? { surface: "back" as const, x: surfaces.geometry.back.width / 2, y: BASE / 2 };
      items.add(infos, where.surface, where.x / surfaces.geometry[where.surface].width, where.y / BASE);
      updateRemoveButton();
    }
  });
}

// ---------- Zoomed-in whiteboards and notes ----------

/** The mode to go back to when the zoomed-in whiteboard or note closes. */
let focusReturn: Mode = "use";

function openFocus(id: string): void {
  const item = items.find(id);
  if (!item || !(item.kind === "note" || item.kind === "whiteboard" || PANEL_KINDS.has(item.kind))) return;
  if (mode === "use") {
    // Behind the desktop icons there is no keyboard: come to the front first.
    void invoke("bring_to_front");
    focusReturn = "use";
  } else if (mode !== "focus") {
    focusReturn = mode;
  }
  items.select(null);
  mode = "focus";
  document.body.dataset.mode = "focus";
  editbar.hidden = true;
  closeAddMenu();
  const leave = () => {
    refreshMirrorsSoon();
    const back = focusReturn;
    focusReturn = "use";
    if (mode !== "focus") return; // switched to another mode from the tray
    if (back === "use") {
      void invoke("finish_front_mode");
      setMode("use");
    } else {
      setMode(back);
    }
  };
  if (PANEL_KINDS.has(item.kind)) {
    if (item.kind === "tv") items.hushTv(true);
    panels.open(
      item,
      (changes) => items.update(id, changes),
      (changes) => {
        items.update(id, changes);
        items.hushTv(false);
        leave();
      },
    );
    return;
  }
  const done: Parameters<FocusEditor["openNote"]>[3] = (result) => {
    if (result?.kind === "note") items.update(result.id, { text: result.text, color: result.color });
    else if (result) void items.refreshBoard(result.id);
    leave();
  };
  if (item.kind === "note") focusEditor.openNote(id, item.text ?? "", item.color ?? "", done);
  else void focusEditor.openBoard(id, done);
}

function toggleFire(item: Item): void {
  items.update(item.id, { sound: item.sound === "fire" ? "none" : "fire" });
}

// ---------- Use mode: clicking items ----------

function activate(id: string): void {
  const item = items.find(id);
  if (!item) return;
  if (isFile(item.kind)) {
    if (item.path) invoke("open_item", { path: item.path }).catch((e) => console.error(e));
    return;
  }
  const flash = (cls: string, ms: number) => {
    const target = items.element(id);
    if (!target) return;
    target.classList.remove(cls);
    void target.offsetWidth; // restart the animation
    target.classList.add(cls);
    window.setTimeout(() => target.classList.remove(cls), ms);
  };
  switch (item.kind) {
    case "plant":
      items.update(id, { watered: Date.now() });
      flash("watering", 1500);
      break;
    case "rose":
    case "apple":
      items.update(id, { since: Date.now() });
      flash("fresh", 800);
      break;
    case "recycle":
      invoke("open_recycle_bin").catch((e) => console.error(e));
      break;
    case "fireplace":
      toggleFire(item);
      break;
    case "note":
    case "whiteboard":
    case "thermometer":
    case "hygrometer":
    case "map":
    case "window":
    case "tv":
      openFocus(id);
      break;
    default:
      break; // pictures, stickers, clocks and mirrors just sit there
  }
}

// Clicks behind the desktop icons arrive from the mouse watcher in Rust.
void listen<{ monitor: number; id: string }>("item-activate", (e) => {
  if (mode === "use" && e.payload.monitor === monitorIndex) activate(e.payload.id);
});
// If the room couldn't get behind the icons, it is a normal window and gets clicks directly.
document.addEventListener("click", (e) => {
  if (mode !== "use") return;
  const el = (e.target as HTMLElement).closest<HTMLElement>(".item");
  if (el?.dataset.id) activate(el.dataset.id);
});

// Clocks tick, and the plant, rose and apple are redrawn as time passes.
window.setInterval(() => {
  tickClocks(surfaces.layer);
  tickDigital(surfaces.layer);
}, 1000);
// Fresh weather for the sensors.
window.setInterval(() => items.refreshWeather(), 15 * 60 * 1000);
// Whether the Recycle Bin has something in it.
async function checkRecycleBin(): Promise<void> {
  if (!items.hasRecycleBin) return;
  const state = await invoke<{ items: number }>("recycle_bin_state").catch(() => null);
  if (state) items.setRecycleCount(state.items);
}
window.setInterval(() => void checkRecycleBin(), 5000);
window.setInterval(() => {
  items.refreshAging();
  refreshMirrorsSoon();
}, 5 * 60 * 1000);
window.setInterval(refreshMirrorsSoon, 30 * 1000);

// ---------- Start ----------

window.addEventListener("DOMContentLoaded", async () => {
  setMode("use");
  void showPhoto();
  try {
    showGrid = await invoke<boolean>("show_grid");
    await findMonitor();
    await loadMonitorData();
  } catch (err) {
    console.error(err);
  }
  render();
  void wireFileDrop();
  void checkRecycleBin();

  void listen("photo-changed", async () => {
    await showPhoto();
    await loadMonitorData();
    render();
  });
  void listen<Mode>("mode", (e) => {
    // "use" after a zoomed-in item closed is just the echo of finishing; nothing to do.
    if (e.payload === "use" && mode === "use") return;
    setMode(e.payload);
  });
  // A game, video or presentation is full-screen: nobody sees the room, so rest.
  void listen<boolean>("quiet", (e) => {
    document.body.classList.toggle("resting", e.payload);
    setResting(e.payload);
    items.restTv(e.payload);
  });
  void listen<boolean>("grid", (e) => {
    showGrid = e.payload;
    render();
  });
  window.addEventListener("resize", render);
  // Monitors rearranged: this window may now cover a different monitor.
  void getCurrentWindow().onMoved(async () => {
    const before = monitorKey;
    await findMonitor();
    if (monitorKey !== before) {
      await loadMonitorData();
      render();
    }
  });
});
