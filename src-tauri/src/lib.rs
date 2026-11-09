//! RoomDesk app entry point.
//!
//! Milestone 1: one room window per monitor, attached to the desktop's wallpaper
//! layer (behind your windows and desktop icons), controlled from a tray icon.

mod monitors;
mod settings;
mod tray;
mod wallpaper;

use std::fs;

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::{AppHandle, Emitter, RunEvent};
use tauri_plugin_dialog::DialogExt;

/// The chosen room photo as a data URL, or `None` to use the built-in sample room.
#[tauri::command]
fn load_photo(app: AppHandle) -> Option<String> {
    let path = settings::load(&app).photo?;
    let bytes = fs::read(&path).ok()?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    let mime = match ext.as_deref() {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        _ => "image/jpeg",
    };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// Let the user pick a room photo. Blocks until the picker closes, so call it
/// from a background thread. Returns `true` when a new photo was chosen.
pub(crate) fn pick_photo(app: &AppHandle) -> Result<bool, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Choose a photo of your room")
        .add_filter("Images", &["jpg", "jpeg", "png", "webp", "bmp", "gif"])
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;

    let mut current = settings::load(app);
    current.photo = Some(path);
    settings::save(app, &current)?;

    // Tell every room window (one per monitor) to reload the photo.
    app.emit("photo-changed", ()).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Go back to the built-in sample room.
pub(crate) fn use_sample_room(app: &AppHandle) -> Result<(), String> {
    let mut current = settings::load(app);
    current.photo = None;
    settings::save(app, &current)?;
    app.emit("photo-changed", ()).map_err(|e| e.to_string())
}

/// Put the normal desktop back the way it was.
fn restore_desktop() {
    wallpaper::set_desktop_icons_visible(true);
    wallpaper::refresh_wallpaper();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![load_photo])
        .setup(|app| {
            let handle = app.handle();
            tray::create(handle)?;
            monitors::start(handle);
            if settings::load(handle).hide_icons {
                wallpaper::set_desktop_icons_visible(false);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("RoomDesk failed to start");

    app.run(|_app, event| match event {
        // Room windows can disappear (for example when Explorer restarts) and are
        // rebuilt a moment later. Only "Exit" in the tray should end the app.
        RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
        RunEvent::Exit => restore_desktop(),
        _ => {}
    });
}
