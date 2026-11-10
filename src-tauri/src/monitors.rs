//! One room window per monitor.
//!
//! Each window covers exactly one monitor, using that monitor's real pixel size,
//! so every screen is sharp at its own scaling (100%, 125%, 150% ...), and is
//! attached to the desktop's wallpaper layer (see `wallpaper`).
//!
//! A background check every 2 seconds notices when monitors are plugged in,
//! unplugged, rearranged or rescaled, or when Explorer restarts, and rebuilds
//! the windows to match.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::wallpaper::{self, Mode};

/// Window labels look like "room-0", "room-1", ... (one per monitor, in Windows' order).
pub const LABEL_PREFIX: &str = "room-";

/// Shared state about the room windows.
#[derive(Default)]
pub struct RoomState {
    pub paused: AtomicBool,
    /// While calibrating or editing items, the rooms are normal windows in front
    /// so they can be clicked and receive files dragged from File Explorer.
    pub front: AtomicBool,
    /// True when every room window made it into the wallpaper layer at the last sync.
    all_attached: AtomicBool,
    /// Serialises syncs so the timer and the tray never rebuild windows at the same time.
    sync_lock: Mutex<()>,
}

#[derive(Debug, Clone, PartialEq)]
struct MonitorInfo {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    /// Scale factor times 1000 (100% = 1000), stored as a whole number so it compares exactly.
    scale_milli: u32,
}

fn current_monitors(app: &AppHandle) -> Vec<MonitorInfo> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| MonitorInfo {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale_milli: (m.scale_factor() * 1000.0).round() as u32,
        })
        .collect()
}

pub fn room_windows(app: &AppHandle) -> Vec<(usize, tauri::WebviewWindow)> {
    app.webview_windows()
        .into_iter()
        .filter_map(|(label, w)| {
            label
                .strip_prefix(LABEL_PREFIX)
                .and_then(|n| n.parse::<usize>().ok())
                .map(|i| (i, w))
        })
        .collect()
}

/// Make the set of room windows match the given monitors.
fn sync_windows(app: &AppHandle, monitors: &[MonitorInfo]) {
    let state = app.state::<RoomState>();
    let _guard = state.sync_lock.lock().unwrap_or_else(|e| e.into_inner());
    let paused = state.paused.load(Ordering::SeqCst);
    let front = state.front.load(Ordering::SeqCst);

    // Close windows for monitors that are gone.
    for (i, window) in room_windows(app) {
        if i >= monitors.len() {
            let _ = window.destroy();
        }
    }

    let mut modes = Vec::new();
    for (i, m) in monitors.iter().enumerate() {
        let label = format!("{LABEL_PREFIX}{i}");
        let window = match app.get_webview_window(&label) {
            Some(w) => w,
            None => {
                let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
                    .title("RoomDesk")
                    .decorations(false)
                    .resizable(false)
                    .shadow(false)
                    .skip_taskbar(true)
                    // Used only if attaching to the wallpaper layer fails.
                    .always_on_bottom(true)
                    .focused(false)
                    // macOS: the first click on a room also reaches the page, instead of
                    // only bringing RoomDesk forward (no effect on Windows).
                    .accept_first_mouse(true)
                    .visible(false)
                    // Tauri's usual WebView2 settings, plus letting the fireplace and window
                    // sounds start without a click (clicks reach the room through the mouse
                    // hook, which the browser doesn't count as the user starting playback).
                    .additional_browser_args(
                        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required",
                    )
                    .build();
                match built {
                    Ok(w) => w,
                    Err(e) => {
                        eprintln!("RoomDesk: could not create window for monitor {}: {e}", i + 1);
                        continue;
                    }
                }
            }
        };

        // Position first, then size: once the window is on the right monitor,
        // Windows applies that monitor's scaling before we set the size.
        #[cfg(not(target_os = "macos"))]
        {
            let _ = window.set_position(tauri::PhysicalPosition::new(m.x, m.y));
            let _ = window.set_size(tauri::PhysicalSize::new(m.width, m.height));
        }
        // macOS places windows in points, and each monitor's pixels are its points
        // times its own scale (2 on a Retina screen), so convert with that scale.
        #[cfg(target_os = "macos")]
        {
            let scale = m.scale_milli.max(1) as f64 / 1000.0;
            let _ = window.set_position(tauri::LogicalPosition::new(m.x as f64 / scale, m.y as f64 / scale));
            let _ = window.set_size(tauri::LogicalSize::new(m.width as f64 / scale, m.height as f64 / scale));
        }
        let _ = window.show();

        // "Always at the back" would push the window below the wallpaper once it is
        // inside Explorer's desktop, so switch it off before attaching, and back on
        // only if attaching fails.
        let _ = window.set_always_on_bottom(false);
        if front {
            wallpaper::detach(&window, m.x, m.y, m.width, m.height);
            let _ = window.set_always_on_top(true);
            let _ = window.set_focus();
            continue;
        }
        let _ = window.set_always_on_top(false);
        let mode = wallpaper::attach(&window, m.x, m.y, m.width, m.height);
        if matches!(mode, Mode::Fallback(_)) {
            let _ = window.set_always_on_bottom(true);
        }
        if paused {
            let _ = window.hide();
        }
        modes.push(mode);
    }

    crate::input::set_monitors(
        monitors
            .iter()
            .map(|m| crate::input::MonitorRect { x: m.x, y: m.y, w: m.width, h: m.height })
            .collect(),
    );
    if front {
        crate::input::set_active(false);
        crate::tray::set_info(app, "Room: editing (in front)", "Press Done when finished");
        return;
    }
    crate::input::set_active(!paused);

    let all_attached = !modes.is_empty() && modes.iter().all(|m| !matches!(m, Mode::Fallback(_)));
    state.all_attached.store(all_attached, Ordering::SeqCst);

    // Report in the tray menu.
    let status = match modes.first() {
        Some(mode) => format!("Room: {}", mode.describe()),
        None => "Room: no monitors found".to_string(),
    };
    let screens: Vec<String> = monitors
        .iter()
        .map(|m| format!("{}×{} at {}%", m.width, m.height, (m.scale_milli as f64 / 10.0).round()))
        .collect();
    crate::tray::set_info(app, &status, &format!("Monitors: {}", screens.join(", ")));
    for (i, mode) in modes.iter().enumerate() {
        println!("RoomDesk: monitor {} → {}", i + 1, mode.describe());
    }
}

/// Windows missing, or no longer inside Explorer's desktop (for example after Explorer restarted)?
fn needs_repair(app: &AppHandle, expected: usize) -> bool {
    let windows = room_windows(app);
    if windows.len() != expected {
        return true;
    }
    let state = app.state::<RoomState>();
    if state.front.load(Ordering::SeqCst) {
        return false;
    }
    state.all_attached.load(Ordering::SeqCst) && windows.iter().any(|(_, w)| !wallpaper::is_attached(w))
}

/// Rebuild all room windows soon (used by the tray, for example after resuming).
///
/// Runs on a background thread: window calls made under `sync_lock` wait for the
/// main thread, so the main thread itself must never wait for that lock.
pub fn resync(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let monitors = current_monitors(&app);
        sync_windows(&app, &monitors);
    });
}

/// Bring the rooms to the front (out of the desktop) so they can be clicked and
/// edited, or put them back behind the icons.
pub fn set_front(app: &AppHandle, on: bool) {
    app.state::<RoomState>().front.store(on, Ordering::SeqCst);
    if on {
        app.state::<RoomState>().paused.store(false, Ordering::SeqCst);
    }
    resync(app);
}

/// Whether the rooms are currently in front (editing, calibrating or a zoomed-in item).
pub fn is_front(app: &AppHandle) -> bool {
    app.state::<RoomState>().front.load(Ordering::SeqCst)
}

/// Show or hide every room window.
pub fn set_paused(app: &AppHandle, paused: bool) {
    app.state::<RoomState>().paused.store(paused, Ordering::SeqCst);
    crate::input::set_active(!paused);
    if paused {
        for (_, w) in room_windows(app) {
            let _ = w.hide();
        }
    } else {
        resync(app);
    }
}

/// Create the windows now and keep them in sync with the monitors from then on.
pub fn start(app: &AppHandle) {
    app.manage(RoomState::default());
    let mut known = current_monitors(app);
    sync_windows(app, &known);

    let app = app.clone();
    let mut quiet = false;
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        // Rest (pause videos, sounds and animations) while something is full-screen.
        // Our own rooms are full-screen while editing, so that doesn't count.
        let busy = !is_front(&app) && crate::system::screen_busy();
        if busy != quiet {
            quiet = busy;
            let _ = app.emit("quiet", quiet);
        }
        let now = current_monitors(&app);
        // An empty list can happen for a moment while Windows switches displays; ignore it.
        if now.is_empty() {
            continue;
        }
        if now != known || needs_repair(&app, now.len()) {
            sync_windows(&app, &now);
            known = now;
        }
    });
}
