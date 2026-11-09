//! One room window per monitor.
//!
//! Each window covers exactly one monitor, using that monitor's real pixel size,
//! so every screen is sharp at its own scaling (100%, 125%, 150% ...).
//! A background check notices when monitors are plugged in, unplugged, rearranged
//! or rescaled, and rebuilds the windows to match.

use std::{thread, time::Duration};

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

/// Window labels look like "room-0", "room-1", ... (one per monitor, in Windows' order).
pub const LABEL_PREFIX: &str = "room-";

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

/// Make the set of room windows match the given monitors.
fn sync_windows(app: &AppHandle, monitors: &[MonitorInfo]) {
    // Close windows for monitors that are gone.
    for (label, window) in app.webview_windows() {
        let index = label
            .strip_prefix(LABEL_PREFIX)
            .and_then(|n| n.parse::<usize>().ok());
        if let Some(i) = index {
            if i >= monitors.len() {
                let _ = window.destroy();
            }
        }
    }

    // Create or move one window per monitor.
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
                    // Until step 3 attaches it to the wallpaper layer,
                    // keep the room behind all other windows.
                    .always_on_bottom(true)
                    .focused(false)
                    .visible(false)
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
        let _ = window.set_position(PhysicalPosition::new(m.x, m.y));
        let _ = window.set_size(PhysicalSize::new(m.width, m.height));
        let _ = window.show();
    }
}

/// Create the windows now and keep them in sync with the monitors from then on.
pub fn start(app: &AppHandle) {
    let mut known = current_monitors(app);
    sync_windows(app, &known);

    let app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let now = current_monitors(&app);
        // An empty list can happen for a moment while Windows switches displays; ignore it.
        if !now.is_empty() && now != known {
            sync_windows(&app, &now);
            known = now;
        }
    });
}
