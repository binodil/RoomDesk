//! RoomDesk app entry point.
//!
//! Step 2: one full-screen room window per monitor showing a photo of a room.
//! Step 3 will attach these windows to the Windows wallpaper layer. That code will
//! live in its own module, so a macOS version can be added beside it later.

mod monitors;
mod settings;

use std::fs;

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::{AppHandle, Emitter};
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

/// Let the user pick a room photo. Returns `true` when a new photo was chosen.
#[tauri::command]
async fn choose_photo(app: AppHandle) -> Result<bool, String> {
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

    let mut current = settings::load(&app);
    current.photo = Some(path);
    settings::save(&app, &current)?;

    // Tell every room window (one per monitor) to reload the photo.
    app.emit("photo-changed", ()).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Go back to the built-in sample room.
#[tauri::command]
fn reset_photo(app: AppHandle) -> Result<(), String> {
    let mut current = settings::load(&app);
    current.photo = None;
    settings::save(&app, &current)?;
    app.emit("photo-changed", ()).map_err(|e| e.to_string())
}

/// Close RoomDesk (all windows).
#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![load_photo, choose_photo, reset_photo, quit])
        .setup(|app| {
            monitors::start(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("RoomDesk failed to start");
}
