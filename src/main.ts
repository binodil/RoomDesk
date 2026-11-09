import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { availableMonitors, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

// Step 2: every monitor gets its own window like this one, showing the room photo.
// The small bar at the top appears when you move the mouse and hides itself again.

const photo = document.getElementById("photo") as HTMLDivElement;
const bar = document.getElementById("bar") as HTMLDivElement;
const info = document.getElementById("info") as HTMLSpanElement;

const SAMPLE_ROOM = "/default-room.jpg";

async function showPhoto(): Promise<void> {
  let url = SAMPLE_ROOM;
  try {
    url = (await invoke<string | null>("load_photo")) ?? SAMPLE_ROOM;
  } catch (err) {
    console.error("Could not load the room photo:", err);
  }
  photo.style.backgroundImage = `url("${url}")`;
}

async function showMonitorInfo(): Promise<void> {
  try {
    const label = getCurrentWindow().label; // "room-0", "room-1", ...
    const index = Number(label.replace("room-", "")) + 1;
    const [here, all] = await Promise.all([currentMonitor(), availableMonitors()]);
    const size = here ? `${here.size.width}×${here.size.height}` : "";
    const scale = here ? `${Math.round(here.scaleFactor * 100)}%` : "";
    info.textContent = `RoomDesk · Monitor ${index} of ${all.length} · ${size} · ${scale}`;
  } catch {
    info.textContent = "RoomDesk";
  }
}

// Show the bar on mouse movement, hide it after a few quiet seconds.
let hideTimer: number | undefined;
function revealBar(): void {
  bar.classList.add("show");
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!bar.matches(":hover")) bar.classList.remove("show");
  }, 4000);
}

function wireButtons(): void {
  document.getElementById("choose")?.addEventListener("click", () => {
    invoke<boolean>("choose_photo").catch((err) => alertInBar(String(err)));
  });
  document.getElementById("reset")?.addEventListener("click", () => {
    invoke("reset_photo").catch((err) => alertInBar(String(err)));
  });
  document.getElementById("exit")?.addEventListener("click", () => void invoke("quit"));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") void invoke("quit");
  });
  window.addEventListener("mousemove", revealBar);
  bar.addEventListener("mouseleave", revealBar);
}

function alertInBar(message: string): void {
  info.textContent = message;
  revealBar();
}

window.addEventListener("DOMContentLoaded", () => {
  wireButtons();
  void showPhoto();
  void showMonitorInfo();
  revealBar();
  // Another monitor's window changed the photo: reload it here too.
  void listen("photo-changed", () => void showPhoto());
  // Moved to a different monitor or the scaling changed: refresh the label.
  void getCurrentWindow().onScaleChanged(() => void showMonitorInfo());
  void getCurrentWindow().onMoved(() => void showMonitorInfo());
});
