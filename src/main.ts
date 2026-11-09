import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// One of these pages runs on each monitor, behind your desktop icons.
// Everything is controlled from the RoomDesk tray icon.

const photo = document.getElementById("photo") as HTMLDivElement;
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

window.addEventListener("DOMContentLoaded", () => {
  void showPhoto();
  // The photo was changed from the tray: reload it.
  void listen("photo-changed", () => void showPhoto());
});
