//! Clicking room items while they sit behind the desktop icons.
//!
//! In the wallpaper layer the room never receives mouse clicks: Windows sends
//! them to its desktop-icon layer on top. So RoomDesk watches the mouse (a
//! "low-level mouse hook", the same approach wallpaper apps like Lively use).
//! When you click on bare desktop exactly where a room item is drawn, RoomDesk
//! keeps that click away from the desktop and tells the room to open the item.
//! Every other click passes through untouched.
//!
//! Each room page reports where its items are (screen rectangles) with
//! `set_hit_regions` whenever the layout changes.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// A clickable rectangle, in physical pixels relative to its monitor's top-left corner.
#[derive(Debug, Clone, Deserialize)]
pub struct Region {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct Activate {
    /// Which monitor's room (0 = first).
    pub monitor: usize,
    pub id: String,
}

#[derive(Debug, Clone, Copy)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
/// Off while editing, calibrating or paused (the rooms then handle the mouse themselves, or not at all).
static ACTIVE: AtomicBool = AtomicBool::new(false);
static REGIONS: OnceLock<Mutex<HashMap<usize, Vec<Region>>>> = OnceLock::new();
static MONITORS: OnceLock<Mutex<Vec<MonitorRect>>> = OnceLock::new();

fn regions() -> &'static Mutex<HashMap<usize, Vec<Region>>> {
    REGIONS.get_or_init(Default::default)
}
fn monitors() -> &'static Mutex<Vec<MonitorRect>> {
    MONITORS.get_or_init(Default::default)
}

pub fn set_active(on: bool) {
    ACTIVE.store(on, Ordering::SeqCst);
}

pub fn set_monitors(rects: Vec<MonitorRect>) {
    *monitors().lock().unwrap_or_else(|e| e.into_inner()) = rects;
}

pub fn set_regions(monitor: usize, list: Vec<Region>) {
    regions().lock().unwrap_or_else(|e| e.into_inner()).insert(monitor, list);
}

/// The room item under a screen point, if any.
#[cfg_attr(not(windows), allow(dead_code))]
fn hit(x: i32, y: i32) -> Option<(usize, String)> {
    let mons = monitors().lock().ok()?.clone();
    let (index, m) = mons
        .iter()
        .enumerate()
        .find(|(_, m)| x >= m.x && y >= m.y && x < m.x + m.w as i32 && y < m.y + m.h as i32)?;
    let (lx, ly) = ((x - m.x) as f64, (y - m.y) as f64);
    let regions = regions().lock().ok()?;
    // Last drawn is on top, so search from the end.
    regions.get(&index)?.iter().rev().find(|r| lx >= r.x && ly >= r.y && lx <= r.x + r.w && ly <= r.y + r.h).map(|r| (index, r.id.clone()))
}

pub fn start(app: &AppHandle) {
    let _ = APP.set(app.clone());
    #[cfg(windows)]
    windows_hook::start();
}

#[cfg(windows)]
mod windows_hook {
    use std::sync::Mutex;
    use std::{sync::atomic::Ordering, thread};

    use tauri::Emitter;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetAncestor, GetClassNameW, GetMessageW, SetWindowsHookExW,
        TranslateMessage, WindowFromPoint, GA_ROOT, HC_ACTION, MSG, MSLLHOOKSTRUCT, WH_MOUSE_LL,
        WM_LBUTTONDOWN, WM_LBUTTONUP,
    };

    use super::{hit, Activate, ACTIVE, APP};

    /// The item the left button went down on, waiting for the button to come up.
    static PRESSED: Mutex<Option<(usize, String)>> = Mutex::new(None);

    /// Is this point on the bare desktop (not on some app's window)?
    fn over_desktop(pt: POINT) -> bool {
        unsafe {
            let hwnd = WindowFromPoint(pt);
            if hwnd.is_invalid() {
                return false;
            }
            let root: HWND = GetAncestor(hwnd, GA_ROOT);
            let mut buf = [0u16; 64];
            let len = GetClassNameW(root, &mut buf);
            let class = String::from_utf16_lossy(&buf[..len.max(0) as usize]);
            class == "Progman" || class == "WorkerW"
        }
    }

    unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && ACTIVE.load(Ordering::SeqCst) {
            let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
            let pt = info.pt;
            match wparam.0 as u32 {
                WM_LBUTTONDOWN => {
                    if over_desktop(pt) {
                        if let Some(target) = hit(pt.x, pt.y) {
                            *PRESSED.lock().unwrap_or_else(|e| e.into_inner()) = Some(target);
                            return LRESULT(1); // keep it from the desktop icons
                        }
                    }
                }
                WM_LBUTTONUP => {
                    let pressed = PRESSED.lock().unwrap_or_else(|e| e.into_inner()).take();
                    if let Some((monitor, id)) = pressed {
                        // Open only if released over the same item (like a normal click).
                        if hit(pt.x, pt.y).as_ref().map(|(m, i)| (*m, i.as_str())) == Some((monitor, id.as_str())) {
                            if let Some(app) = APP.get() {
                                let _ = app.emit("item-activate", Activate { monitor, id });
                            }
                        }
                        return LRESULT(1);
                    }
                }
                _ => {}
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    pub fn start() {
        thread::spawn(|| unsafe {
            // A low-level hook runs on the thread that installed it, which needs a message loop.
            if SetWindowsHookExW(WH_MOUSE_LL, Some(hook), None, 0).is_err() {
                eprintln!("RoomDesk: could not watch the mouse; items behind the icons won't be clickable");
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}
