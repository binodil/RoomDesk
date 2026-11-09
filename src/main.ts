import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { availableMonitors, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { Items, parseLayout, type ItemInfo } from "./items";
import { POINT_NAMES, defaultCalibration, parseCalibration, type Calibration, type PointName } from "./room";
import { BASE, SURFACE_NAMES, Surfaces } from "./surfaces";

// One of these pages runs on each monitor, behind your desktop icons.
// Modes (switched from the tray):
//   use       – behind the icons; clicking an item opens it
//   edit      – in front; drag files in, move, resize and remove items
//   calibrate – in front; drag the room's corners onto the photo

type Mode = "use" | "edit" | "calibrate";

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
});

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
  if ((e.target as HTMLElement).closest(".toolbar")) return;
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
    if (mode !== "edit") return;
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
  const picked = await invoke<ItemInfo[]>("pick_items").catch(() => []);
  if (picked.length) items.add(picked, "back", 0.2, 0.45);
  updateRemoveButton();
});
removeBtn.addEventListener("click", () => {
  if (items.selectedId) items.remove(items.selectedId);
});
$("editDone").addEventListener("click", () => void invoke("finish_front_mode"));

window.addEventListener("keydown", (e) => {
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

// ---------- Use mode: opening items ----------

function openItem(id: string): void {
  const item = items.find(id);
  if (item) invoke("open_item", { path: item.path }).catch((e) => console.error(e));
}

// Clicks behind the desktop icons arrive from the mouse watcher in Rust.
void listen<{ monitor: number; id: string }>("item-activate", (e) => {
  if (mode === "use" && e.payload.monitor === monitorIndex) openItem(e.payload.id);
});
// If the room couldn't get behind the icons, it is a normal window and gets clicks directly.
document.addEventListener("click", (e) => {
  if (mode !== "use") return;
  const el = (e.target as HTMLElement).closest<HTMLElement>(".item");
  if (el?.dataset.id) openItem(el.dataset.id);
});

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

  void listen("photo-changed", async () => {
    await showPhoto();
    await loadMonitorData();
    render();
  });
  void listen<Mode>("mode", (e) => setMode(e.payload));
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
