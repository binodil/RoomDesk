// Whiteboards and notes, zoomed in so you can draw and type on them.
//
// A whiteboard is saved in its own file (drawings and pictures can be large):
// the ink is one PNG, text and pictures sit on top at percentage positions.

import { invoke } from "@tauri-apps/api/core";
import { NOTE_COLORS, escapeHtml } from "./decor";

export type BoardText = { x: number; y: number; c: string; text: string };
export type BoardPic = { x: number; y: number; w: number; src: string };
export type Board = { version: 1; ink: string | null; notes: BoardText[]; pics: BoardPic[] };

export const INK_W = 1600;
export const INK_H = 1000;
const PEN_COLORS = ["#1d2633", "#2463c9", "#d23b3b", "#1f8a55"];

const emptyBoard = (): Board => ({ version: 1, ink: null, notes: [], pics: [] });

function parseBoard(data: unknown): Board {
  const b = data as Partial<Board> | null;
  if (!b || typeof b !== "object") return emptyBoard();
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    version: 1,
    ink: typeof b.ink === "string" && b.ink.startsWith("data:image/") ? b.ink : null,
    notes: (Array.isArray(b.notes) ? b.notes : [])
      .filter((n) => typeof n?.text === "string")
      .map((n) => ({ x: num(n.x, 10), y: num(n.y, 10), c: typeof n.c === "string" ? n.c : PEN_COLORS[0], text: n.text })),
    pics: (Array.isArray(b.pics) ? b.pics : [])
      .filter((p) => typeof p?.src === "string" && p.src.startsWith("data:image/"))
      .map((p) => ({ x: num(p.x, 30), y: num(p.y, 20), w: num(p.w, 28), src: p.src })),
  };
}

// ---------- Saved boards ----------

const boards = new Map<string, Promise<Board>>();

export function loadBoard(id: string): Promise<Board> {
  let p = boards.get(id);
  if (!p) {
    p = invoke("load_board", { id }).then(parseBoard).catch(() => emptyBoard());
    boards.set(id, p);
  }
  return p;
}

function saveBoard(id: string, board: Board): void {
  boards.set(id, Promise.resolve(board));
  invoke("save_board", { id, board }).catch((e) => console.error("Could not save the whiteboard:", e));
}

export function deleteBoard(id: string): void {
  boards.delete(id);
  invoke("delete_board", { id }).catch(() => {});
}

/** The board's contents as shown on the wall (or, with `live`, ready to edit). */
export function boardHtml(b: Board, live = false): string {
  const pics = b.pics
    .map((p) => `<img class="wbpic" src="${p.src}" style="left:${p.x}%;top:${p.y}%;width:${p.w}%" alt="" draggable="false">`)
    .join("");
  const ink = live
    ? `<canvas class="ink" width="${INK_W}" height="${INK_H}"></canvas>`
    : b.ink
      ? `<img class="ink" src="${b.ink}" alt="" draggable="false">`
      : "";
  const notes = b.notes
    .map(
      (n) =>
        `<div class="wbtext"${live ? ' contenteditable="true" spellcheck="false"' : ""} style="left:${n.x}%;top:${n.y}%;color:${n.c}">${escapeHtml(n.text)}</div>`,
    )
    .join("");
  return pics + ink + notes;
}

// ---------- The zoomed-in editor ----------

type Tool = "pen" | "text" | "move" | "eraser";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class FocusEditor {
  private overlay = $<HTMLDivElement>("focus");
  private boardWrap = $<HTMLDivElement>("focusBoard");
  private surf = $<HTMLDivElement>("wbSurf");
  private noteWrap = $<HTMLDivElement>("focusNote");
  private noteText = $<HTMLTextAreaElement>("noteText");
  private bar = $<HTMLDivElement>("focusBar");
  private tool: Tool = "pen";
  private color = PEN_COLORS[0];
  private draw: { ctx?: CanvasRenderingContext2D; obj?: HTMLElement; r: DOMRect; sx: number; sy: number; x0: number; y0: number } | null = null;
  private selected: HTMLElement | null = null;
  private current: { kind: "note" | "whiteboard"; id: string } | null = null;
  private onClose: ((result: { kind: "note"; id: string; text: string; color: string } | { kind: "whiteboard"; id: string }) => void) | null = null;

  constructor() {
    this.buildBar();
    this.wireBoard();
    document.addEventListener("paste", (e) => {
      if (this.current?.kind !== "whiteboard") return;
      const file = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
      if (!file) return;
      e.preventDefault();
      const fr = new FileReader();
      fr.onload = () => this.addPic(String(fr.result));
      fr.readAsDataURL(file);
    });
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  openNote(id: string, text: string, color: string, done: FocusEditor["onClose"]): void {
    this.current = { kind: "note", id };
    this.onClose = done;
    this.overlay.dataset.kind = "note";
    this.noteWrap.hidden = false;
    this.boardWrap.hidden = true;
    this.noteText.value = text;
    this.setNoteColor(color);
    this.show();
    setTimeout(() => this.noteText.focus(), 60);
  }

  async openBoard(id: string, done: FocusEditor["onClose"]): Promise<void> {
    this.current = { kind: "whiteboard", id };
    this.onClose = done;
    this.overlay.dataset.kind = "whiteboard";
    this.noteWrap.hidden = true;
    this.boardWrap.hidden = false;
    const board = await loadBoard(id);
    this.surf.innerHTML = boardHtml(board, true);
    if (board.ink) {
      const img = new Image();
      img.onload = () => this.canvas().getContext("2d")?.drawImage(img, 0, 0);
      img.src = board.ink;
    }
    this.setTool("pen");
    this.setColor(this.color);
    this.show();
  }

  /** Save and close. */
  close(): void {
    const cur = this.current;
    if (!cur) return;
    const done = this.onClose;
    this.current = null;
    this.onClose = null;
    this.selected = null;
    this.overlay.hidden = true;
    if (cur.kind === "whiteboard") {
      const pct = (v: string) => parseFloat(v) || 0;
      const board: Board = {
        version: 1,
        ink: this.inkIsEmpty() ? null : this.canvas().toDataURL("image/png"),
        notes: [...this.surf.querySelectorAll<HTMLElement>(".wbtext")]
          .map((el) => ({ x: pct(el.style.left), y: pct(el.style.top), c: el.style.color, text: el.innerText }))
          .filter((n) => n.text.trim()),
        pics: [...this.surf.querySelectorAll<HTMLImageElement>(".wbpic")].map((el) => ({
          x: pct(el.style.left),
          y: pct(el.style.top),
          w: pct(el.style.width),
          src: el.src,
        })),
      };
      saveBoard(cur.id, board);
      this.surf.innerHTML = "";
      done?.({ kind: "whiteboard", id: cur.id });
    } else {
      done?.({ kind: "note", id: cur.id, text: this.noteText.value, color: this.noteWrap.dataset.color ?? NOTE_COLORS[0] });
    }
  }

  private show(): void {
    this.overlay.hidden = false;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const target = this.current?.kind === "note" ? this.noteWrap : this.boardWrap;
      target.animate([{ transform: "scale(.35)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], {
        duration: 320,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    }
  }

  private canvas(): HTMLCanvasElement {
    return this.surf.querySelector("canvas") as HTMLCanvasElement;
  }

  private inkIsEmpty(): boolean {
    const data = this.canvas().getContext("2d")?.getImageData(0, 0, INK_W, INK_H).data;
    if (!data) return true;
    for (let i = 3; i < data.length; i += 16) if (data[i]) return false;
    return true;
  }

  // ---------- Toolbar ----------

  private buildBar(): void {
    const pens = PEN_COLORS.map((c) => `<button type="button" class="sw" data-color="${c}" style="background:${c}" aria-label="Pen colour"></button>`).join("");
    const notes = NOTE_COLORS.map((c) => `<button type="button" class="sw" data-note-color="${c}" style="background:${c}" aria-label="Note colour"></button>`).join("");
    this.bar.innerHTML = `
      <span class="wb-only">
        <button type="button" data-tool="pen">Pen</button>
        <button type="button" data-tool="text">Text</button>
        <button type="button" data-tool="move">Move</button>
        <button type="button" data-tool="eraser">Eraser</button>
        <span class="sep"></span>${pens}<span class="sep"></span>
        <button type="button" data-act="image">Picture…</button>
        <button type="button" data-act="clear">Clear</button>
      </span>
      <span class="note-only">${notes}</span>
      <button type="button" class="primary" data-act="done">Done</button>`;
    this.bar.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.dataset.tool) this.setTool(b.dataset.tool as Tool);
      if (b.dataset.color) {
        this.setColor(b.dataset.color);
        if (this.tool === "eraser" || this.tool === "move") this.setTool("pen");
        if (this.selected?.classList.contains("wbtext")) this.selected.style.color = b.dataset.color;
      }
      if (b.dataset.noteColor) this.setNoteColor(b.dataset.noteColor);
      if (b.dataset.act === "done") this.close();
      if (b.dataset.act === "clear") {
        this.canvas().getContext("2d")?.clearRect(0, 0, INK_W, INK_H);
        this.surf.querySelectorAll(".wbtext, .wbpic").forEach((n) => n.remove());
      }
      if (b.dataset.act === "image") void this.pickPicture();
    });
    this.overlay.addEventListener("pointerdown", (e) => {
      // A click on the dark area around the board or note closes it.
      if (e.target === this.overlay) this.close();
    });
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.surf.className = `wbsurf live t-${t}`;
    this.bar.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
    if (t !== "move") this.select(null);
  }

  private setColor(c: string): void {
    this.color = c;
    this.bar.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === c)));
  }

  private setNoteColor(c: string): void {
    this.noteWrap.dataset.color = c;
    this.noteWrap.style.setProperty("--note", c);
    this.bar.querySelectorAll<HTMLButtonElement>("[data-note-color]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.noteColor === c)));
  }

  private select(el: HTMLElement | null): void {
    this.selected?.classList.remove("chosen");
    this.selected = el;
    el?.classList.add("chosen");
  }

  private async pickPicture(): Promise<void> {
    const path = await invoke<string | null>("pick_image").catch(() => null);
    if (!path) return;
    const src = await invoke<string>("load_image", { path }).catch(() => null);
    if (src) this.addPic(src);
  }

  private addPic(src: string): void {
    const img = document.createElement("img");
    img.className = "wbpic";
    img.alt = "";
    img.draggable = false;
    img.src = src;
    Object.assign(img.style, { left: "35%", top: "25%", width: "28%" });
    this.surf.insertBefore(img, this.surf.firstChild);
    this.setTool("move");
    this.select(img);
  }

  // ---------- Drawing, typing and moving ----------

  private wireBoard(): void {
    const surf = this.surf;
    surf.addEventListener("pointerdown", (e) => {
      const r = surf.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const obj = (e.target as HTMLElement).closest<HTMLElement>(".wbtext, .wbpic");
      if (this.tool === "move") {
        this.select(obj);
        if (!obj) return;
        e.preventDefault();
        this.draw = { obj, r, sx: e.clientX, sy: e.clientY, x0: parseFloat(obj.style.left), y0: parseFloat(obj.style.top) };
        surf.setPointerCapture(e.pointerId);
        return;
      }
      if (this.tool === "text") {
        if (obj) return; // clicking existing text edits it
        e.preventDefault();
        const t = document.createElement("div");
        t.className = "wbtext";
        t.contentEditable = "true";
        t.spellcheck = false;
        Object.assign(t.style, { left: `${px * 100}%`, top: `${py * 100 - 3}%`, color: this.color });
        surf.appendChild(t);
        t.focus();
        setTimeout(() => t.focus());
        return;
      }
      e.preventDefault();
      const ctx = this.canvas().getContext("2d");
      if (!ctx) return;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = this.tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.tool === "eraser" ? 44 : 7;
      ctx.beginPath();
      ctx.moveTo(px * INK_W, py * INK_H);
      ctx.lineTo(px * INK_W + 0.1, py * INK_H);
      ctx.stroke();
      this.draw = { ctx, r, sx: 0, sy: 0, x0: 0, y0: 0 };
      surf.setPointerCapture(e.pointerId);
    });
    surf.addEventListener("pointermove", (e) => {
      const d = this.draw;
      if (!d) return;
      if (d.obj) {
        d.obj.style.left = `${d.x0 + ((e.clientX - d.sx) / d.r.width) * 100}%`;
        d.obj.style.top = `${d.y0 + ((e.clientY - d.sy) / d.r.height) * 100}%`;
        return;
      }
      d.ctx?.lineTo(((e.clientX - d.r.left) / d.r.width) * INK_W, ((e.clientY - d.r.top) / d.r.height) * INK_H);
      d.ctx?.stroke();
    });
    const end = () => (this.draw = null);
    surf.addEventListener("pointerup", end);
    surf.addEventListener("pointercancel", end);

    // Scroll over a picture (Move tool) to resize it; Delete removes the chosen text or picture.
    surf.addEventListener(
      "wheel",
      (e) => {
        const pic = (e.target as HTMLElement).closest<HTMLElement>(".wbpic");
        if (this.tool !== "move" || !pic) return;
        e.preventDefault();
        const w = parseFloat(pic.style.width) * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
        pic.style.width = `${Math.min(100, Math.max(5, w))}%`;
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      if (!this.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && this.tool === "move" && this.selected) {
        e.preventDefault();
        this.selected.remove();
        this.selected = null;
      }
    });
  }
}
