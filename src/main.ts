import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { availableMonitors, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { isConvex, rectToQuad, toMatrix3d } from "./homography";
import {
  POINT_NAMES,
  SURFACES,
  SURFACE_LABELS,
  defaultCalibration,
  parseCalibration,
  surfaceQuad,
  type Calibration,
  type PointName,
  type SurfaceName,
} from "./room";

// One of these pages runs on each monitor, behind your desktop icons.
// Everything is controlled from the RoomDesk tray icon.

const SAMPLE_ROOM = "/default-room.jpg";
/** Size of the flat grid before it is bent onto a surface. */
const BASE = 1000;

const photo = document.getElementById("photo") as HTMLDivElement;
const surfacesLayer = document.getElementById("surfaces") as HTMLDivElement;
const editor = document.getElementById("editor") as HTMLDivElement;
const outlines = document.getElementById("outlines") as unknown as SVGSVGElement;
const handlesLayer = document.getElementById("handles") as HTMLDivElement;

let calibration: Calibration = defaultCalibration();
let monitorKey = "";
let calibrating = false;
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

// ---------- Calibration storage (one per monitor) ----------

async function findMonitorKey(): Promise<void> {
  const m = await currentMonitor();
  monitorKey = m ? `${m.name ?? "monitor"}|${m.size.width}x${m.size.height}` : "unknown";
  const label = getCurrentWindow().label; // "room-0", "room-1", ...
  const index = Number(label.replace("room-", "")) + 1;
  const total = (await availableMonitors()).length;
  const title = document.getElementById("calTitle");
  if (title) title.textContent = `Calibrate monitor ${index} of ${total}`;
}

async function loadCalibration(): Promise<void> {
  try {
    calibration = parseCalibration(await invoke("load_calibration", { monitor: monitorKey }));
  } catch {
    calibration = defaultCalibration();
  }
}

let saveTimer: number | undefined;
function saveCalibrationSoon(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    invoke("save_calibration", { monitor: monitorKey, calibration }).catch((err) =>
      console.error("Could not save calibration:", err),
    );
  }, 250);
}

// ---------- Drawing the surfaces ----------

const surfaceEls = {} as Record<SurfaceName, HTMLDivElement>;
for (const name of Object.keys(SURFACES) as SurfaceName[]) {
  const el = document.createElement("div");
  el.className = `surface surface-${name}`;
  el.innerHTML = `<span>${SURFACE_LABELS[name]}</span>`;
  surfacesLayer.appendChild(el);
  surfaceEls[name] = el;
}

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
  const w = window.innerWidth;
  const h = window.innerHeight;
  surfacesLayer.hidden = !(showGrid || calibrating);

  let paths = "";
  for (const name of Object.keys(SURFACES) as SurfaceName[]) {
    const quad = surfaceQuad(calibration, name, w, h);
    const el = surfaceEls[name];
    const matrix = isConvex(quad) ? rectToQuad(BASE, BASE, quad) : null;
    if (matrix) {
      el.style.transform = toMatrix3d(matrix);
      el.hidden = false;
    } else {
      // Twisted or flat shape (two corners crossed): hide it rather than draw nonsense.
      el.hidden = true;
    }
    paths += `<polygon class="${matrix ? "" : "bad"}" points="${quad.map((p) => `${p.x},${p.y}`).join(" ")}"/>`;
  }

  if (calibrating) {
    outlines.setAttribute("viewBox", `0 0 ${w} ${h}`);
    outlines.innerHTML = paths;
    for (const name of POINT_NAMES) {
      const p = calibration.points[name];
      handleEls[name].style.left = `${p.x * w}px`;
      handleEls[name].style.top = `${p.y * h}px`;
    }
  }
}

// ---------- Calibrate mode: dragging the corner points ----------

const clamp = (v: number) => Math.min(1, Math.max(0, v));

let dragging: { name: PointName; id: number } | null = null;
handlesLayer.addEventListener("pointerdown", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".handle");
  if (!target) return;
  e.preventDefault();
  target.focus();
  target.setPointerCapture(e.pointerId);
  dragging = { name: target.dataset.point as PointName, id: e.pointerId };
  target.classList.add("active");
});
handlesLayer.addEventListener("pointermove", (e) => {
  if (!dragging || e.pointerId !== dragging.id) return;
  calibration.points[dragging.name] = {
    x: clamp(e.clientX / window.innerWidth),
    y: clamp(e.clientY / window.innerHeight),
  };
  render();
});
const endDrag = (e: PointerEvent) => {
  if (!dragging || e.pointerId !== dragging.id) return;
  handleEls[dragging.name].classList.remove("active");
  dragging = null;
  saveCalibrationSoon();
};
handlesLayer.addEventListener("pointerup", endDrag);
handlesLayer.addEventListener("pointercancel", endDrag);

// Arrow keys nudge the focused point by 1 pixel (10 with Shift).
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
    x: clamp(p.x + d[0] / window.innerWidth),
    y: clamp(p.y + d[1] / window.innerHeight),
  };
  render();
  saveCalibrationSoon();
});

document.getElementById("calReset")?.addEventListener("click", () => {
  calibration = defaultCalibration();
  render();
  saveCalibrationSoon();
});
document.getElementById("calFinish")?.addEventListener("click", () => void invoke("finish_calibration"));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && calibrating) void invoke("finish_calibration");
});

function setCalibrating(on: boolean): void {
  calibrating = on;
  editor.hidden = !on;
  document.body.classList.toggle("calibrating", on);
  render();
}

// ---------- Start ----------

window.addEventListener("DOMContentLoaded", async () => {
  void showPhoto();
  try {
    showGrid = await invoke<boolean>("show_grid");
    await findMonitorKey();
    await loadCalibration();
  } catch (err) {
    console.error(err);
  }
  render();

  void listen("photo-changed", async () => {
    await showPhoto();
    await loadCalibration();
    render();
  });
  void listen<boolean>("calibrate", (e) => setCalibrating(e.payload));
  void listen<boolean>("grid", (e) => {
    showGrid = e.payload;
    render();
  });
  window.addEventListener("resize", render);
  // Moved to another monitor (monitors rearranged): use that monitor's calibration.
  void getCurrentWindow().onMoved(async () => {
    await findMonitorKey();
    await loadCalibration();
    render();
  });
});
