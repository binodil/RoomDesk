//! Settings saved as JSON in the user's app-data folder
//! (%APPDATA%\RoomDesk\settings.json on Windows).

use std::{collections::HashMap, fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// The room photo the user picked. `None` means "use the built-in sample room".
    pub photo: Option<PathBuf>,
    /// Hide the normal Windows desktop icons while RoomDesk runs.
    #[serde(default)]
    pub hide_icons: bool,
    /// Show the perspective test grid on each surface of the room.
    #[serde(default = "yes")]
    pub show_grid: bool,
    /// Room calibration for each monitor (key: monitor name and resolution).
    /// The page decides the format; Rust only stores it.
    #[serde(default)]
    pub calibrations: HashMap<String, serde_json::Value>,
    /// Items placed in the room for each monitor (same key as calibrations).
    #[serde(default)]
    pub layouts: HashMap<String, serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { photo: None, hide_icons: false, show_grid: true, calibrations: HashMap::new(), layouts: HashMap::new() }
    }
}

/// The RoomDesk data folder, created if it does not exist yet.
pub fn data_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .data_dir()
        .map_err(|e| format!("Could not find the app-data folder: {e}"))?
        .join("RoomDesk");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_folder(app)?.join("settings.json"))
}

/// Read the settings. A missing or broken file gives the defaults, so the app always starts.
pub fn load(app: &AppHandle) -> Settings {
    settings_file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_file(app)?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    // Write to a temporary file first, then swap it in, so a crash never leaves half a file.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("Could not save settings: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Could not save settings: {e}"))?;
    Ok(())
}
