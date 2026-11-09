// Mirrors: each one shows a mirrored copy of the room (the photo and every
// item in it), centred on the part of the room across from the mirror.
// No camera is used; the reflection is rebuilt from what RoomDesk draws.

import type { Items } from "./items";
import { BASE, type Surfaces } from "./surfaces";

/** How much of the screen's height a mirror shows. */
const VIEW = 0.8;

export function refreshMirrors(items: Items, surfaces: Surfaces, photoCss: string): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  for (const item of items.layout.items) {
    if (item.kind !== "mirror") continue;
    const el = items.element(item.id);
    const scene = el?.querySelector<HTMLDivElement>(".mscene");
    if (!el || !scene) continue;

    const width = surfaces.geometry[item.surface]?.width ?? BASE;
    const centre = surfaces.toScreen(item.surface, { x: item.x * width, y: item.y * BASE });
    if (!centre) continue;

    const copy = document.createElement("div");
    copy.className = "mroom";
    copy.style.width = `${W}px`;
    copy.style.height = `${H}px`;
    copy.style.backgroundImage = photoCss;
    const room = surfaces.layer.cloneNode(true) as HTMLElement;
    room.removeAttribute("id");
    room.querySelectorAll(".k-mirror, .grid").forEach((n) => n.remove());
    // The reflection is only a picture: it can't be clicked or dragged.
    room.querySelectorAll("[data-id]").forEach((n) => n.removeAttribute("data-id"));
    room.querySelectorAll(".selected, .drop-target").forEach((n) => n.classList.remove("selected", "drop-target"));
    copy.appendChild(room);

    // Flip left-right and centre the reflection on the point across the room
    // from the mirror (a mirror on the right wall shows the left side).
    const cw = scene.offsetWidth;
    const ch = scene.offsetHeight;
    const k = ch / (H * VIEW);
    const tx = cw / 2 + k * (W - centre.x);
    const ty = ch / 2 - k * centre.y;
    copy.style.transform = `translate(${tx}px, ${ty}px) scale(${-k}, ${k})`;
    scene.replaceChildren(copy);
  }
}
