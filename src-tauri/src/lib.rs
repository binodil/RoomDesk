//! RoomDesk app entry point.
//!
//! Step 1 only opens a normal window. Later steps add the wallpaper layer
//! (Windows-specific code will live in its own module so a macOS version can
//! be added beside it), the tray icon and one room window per monitor.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("RoomDesk failed to start");
}
