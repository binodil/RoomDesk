//! RoomDesk app entry point.
//!
//! Milestone 1: one room window per monitor, attached to the desktop's wallpaper
//! layer (behind your windows and desktop icons), controlled from a tray icon.

mod icons;
mod input;
mod monitors;
mod settings;
mod tray;
mod wallpaper;

use std::{collections::HashMap, fs, sync::Mutex};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const IMAGE_EXTENSIONS: [&str; 6] = ["jpg", "jpeg", "png", "webp", "bmp", "gif"];

/// An image file as a data URL the page can show.
fn image_data_url(path: &std::path::Path) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err("not an image".into());
    }
    let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > 40 * 1024 * 1024 {
        return Err("image is larger than 40 MB".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mime = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// The chosen room photo as a data URL, or `None` to use the built-in sample room.
#[tauri::command]
fn load_photo(app: AppHandle) -> Option<String> {
    let path = settings::load(&app).photo?;
    image_data_url(&path).ok()
}

/// A picture placed in the room (or stuck on a whiteboard), as a data URL.
#[tauri::command]
async fn load_image(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || image_data_url(std::path::Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Let the user pick a room photo. Blocks until the picker closes, so call it
/// from a background thread. Returns `true` when a new photo was chosen.
pub(crate) fn pick_photo(app: &AppHandle) -> Result<bool, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Choose a photo of your room")
        .add_filter("Images", &IMAGE_EXTENSIONS)
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;

    let mut current = settings::load(app);
    current.photo = Some(path);
    // Corners marked on the old photo don't fit a new one.
    current.calibrations.clear();
    settings::save(app, &current)?;

    // Tell every room window (one per monitor) to reload the photo.
    app.emit("photo-changed", ()).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Go back to the built-in sample room.
pub(crate) fn use_sample_room(app: &AppHandle) -> Result<(), String> {
    let mut current = settings::load(app);
    current.photo = None;
    current.calibrations.clear();
    settings::save(app, &current)?;
    app.emit("photo-changed", ()).map_err(|e| e.to_string())
}

/// The saved calibration for one monitor, if any.
#[tauri::command]
fn load_calibration(app: AppHandle, monitor: String) -> Option<Value> {
    settings::load(&app).calibrations.get(&monitor).cloned()
}

/// Save the calibration for one monitor (called after every corner drag).
#[tauri::command]
fn save_calibration(app: AppHandle, monitor: String, calibration: Value) -> Result<(), String> {
    let mut current = settings::load(&app);
    current.calibrations.insert(monitor, calibration);
    settings::save(&app, &current)
}

/// Whether the perspective test grid is switched on.
#[tauri::command]
fn show_grid(app: AppHandle) -> bool {
    settings::load(&app).show_grid
}

/// Leave edit or calibrate mode on every monitor and put the rooms back behind the icons.
#[tauri::command]
fn finish_front_mode(app: AppHandle) {
    monitors::set_front(&app, false);
    let _ = app.emit("mode", "use");
}

/// Bring the rooms to the front, in "edit" (items) or "calibrate" (corners) mode.
pub(crate) fn start_front_mode(app: &AppHandle, mode: &str) {
    monitors::set_front(app, true);
    let _ = app.emit("mode", mode);
}

/// The saved items for one monitor, if any.
#[tauri::command]
fn load_layout(app: AppHandle, monitor: String) -> Option<Value> {
    settings::load(&app).layouts.get(&monitor).cloned()
}

/// Save the items for one monitor.
#[tauri::command]
fn save_layout(app: AppHandle, monitor: String, layout: Value) -> Result<(), String> {
    let mut current = settings::load(&app);
    current.layouts.insert(monitor, layout);
    settings::save(&app, &current)
}

/// Name and kind (folder, shortcut, app, file) for each dropped or picked path.
#[tauri::command]
fn describe_paths(paths: Vec<String>) -> Vec<icons::ItemInfo> {
    paths.iter().map(|p| icons::describe(p)).collect()
}

/// Run a file picker on top of the rooms.
///
/// While editing, every room window is always-on-top, which would cover the
/// picker on whichever monitor it opens. So all rooms drop back while it is open,
/// the picker belongs to the window that asked (Windows keeps it above that one),
/// and the rooms come forward again afterwards.
fn with_picker<T>(app: &AppHandle, window: &WebviewWindow, pick: impl FnOnce() -> T) -> T {
    let rooms = monitors::room_windows(app);
    for (_, w) in &rooms {
        let _ = w.set_always_on_top(false);
    }
    let result = pick();
    if monitors::is_front(app) {
        for (_, w) in &rooms {
            let _ = w.set_always_on_top(true);
        }
    }
    let _ = window.set_focus();
    result
}

/// Let the user pick files to add to the room (the file picker in edit mode).
#[tauri::command]
async fn pick_items(app: AppHandle, window: WebviewWindow) -> Vec<icons::ItemInfo> {
    let picked = with_picker(&app, &window, || {
        app.dialog()
            .file()
            .set_title("Add files or shortcuts to the room")
            .set_parent(&window)
            .blocking_pick_files()
    });
    picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .map(|p| icons::describe(&p.to_string_lossy()))
        .collect()
}

/// Let the user pick one picture (for a framed picture or a whiteboard).
#[tauri::command]
async fn pick_image(app: AppHandle, window: WebviewWindow) -> Option<String> {
    let picked = with_picker(&app, &window, || {
        app.dialog()
            .file()
            .set_title("Choose a picture")
            .add_filter("Images", &IMAGE_EXTENSIONS)
            .set_parent(&window)
            .blocking_pick_file()
    });
    picked?.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

/// Bring the rooms in front so one item (a whiteboard or a note) can be used with
/// mouse and keyboard, and give this monitor's room the keyboard.
#[tauri::command]
fn bring_to_front(app: AppHandle, window: WebviewWindow) {
    if !monitors::is_front(&app) {
        monitors::set_front(&app, true);
    }
    // Bringing the rooms forward focuses each one in turn; take the focus back afterwards.
    std::thread::spawn(move || {
        for _ in 0..3 {
            std::thread::sleep(std::time::Duration::from_millis(350));
            let _ = window.set_focus();
        }
    });
}

/// Whiteboards are kept in their own files, since drawings and pictures can be large.
fn board_path(app: &AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("bad whiteboard id".into());
    }
    Ok(settings::data_folder(app)?.join("boards").join(format!("{id}.json")))
}

#[tauri::command]
fn load_board(app: AppHandle, id: String) -> Option<Value> {
    let text = fs::read_to_string(board_path(&app, &id).ok()?).ok()?;
    serde_json::from_str(&text).ok()
}

#[tauri::command]
fn save_board(app: AppHandle, id: String, board: Value) -> Result<(), String> {
    let path = board_path(&app, &id)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, board.to_string()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_board(app: AppHandle, id: String) {
    if let Ok(path) = board_path(&app, &id) {
        let _ = fs::remove_file(path);
    }
}

/// Icons are cached so every room window (and every redraw) doesn't ask Windows again.
#[derive(Default)]
struct IconCache(Mutex<HashMap<String, String>>);

/// The Windows icon or thumbnail for a path, as a PNG data URL.
#[tauri::command]
async fn item_icon(app: AppHandle, path: String) -> Result<String, String> {
    let cache = app.state::<IconCache>();
    if let Some(hit) = cache.0.lock().map_err(|e| e.to_string())?.get(&path) {
        return Ok(hit.clone());
    }
    let p = path.clone();
    let png = tauri::async_runtime::spawn_blocking(move || icons::icon_png(&p, 256))
        .await
        .map_err(|e| e.to_string())??;
    let url = format!("data:image/png;base64,{}", STANDARD.encode(png));
    cache.0.lock().map_err(|e| e.to_string())?.insert(path, url.clone());
    Ok(url)
}

/// Open a file or folder, or start a program or shortcut, the way double-clicking it on the desktop would.
#[tauri::command]
fn open_item(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

/// Where this room's items are on screen, so clicks behind the desktop icons can reach them.
#[tauri::command]
fn set_hit_regions(window: WebviewWindow, regions: Vec<input::Region>) {
    if let Some(index) = window
        .label()
        .strip_prefix(monitors::LABEL_PREFIX)
        .and_then(|n| n.parse::<usize>().ok())
    {
        input::set_regions(index, regions);
    }
}

pub(crate) fn set_show_grid(app: &AppHandle, show: bool) {
    let mut s = settings::load(app);
    s.show_grid = show;
    if let Err(e) = settings::save(app, &s) {
        eprintln!("RoomDesk: {e}");
    }
    let _ = app.emit("grid", show);
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
        .plugin(tauri_plugin_opener::init())
        .manage(IconCache::default())
        .invoke_handler(tauri::generate_handler![
            load_photo,
            load_calibration,
            save_calibration,
            show_grid,
            finish_front_mode,
            load_layout,
            save_layout,
            describe_paths,
            pick_items,
            pick_image,
            load_image,
            bring_to_front,
            load_board,
            save_board,
            delete_board,
            item_icon,
            open_item,
            set_hit_regions
        ])
        .setup(|app| {
            let handle = app.handle();
            tray::create(handle)?;
            input::start(handle);
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
