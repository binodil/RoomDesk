//! Non-Windows placeholder: no wallpaper layer yet, rooms stay normal back-most windows.

use super::Mode;
use tauri::WebviewWindow;

pub fn attach(_window: &WebviewWindow, _x: i32, _y: i32, _w: u32, _h: u32) -> Mode {
    Mode::Fallback("not supported on this system yet".into())
}

pub fn is_attached(_window: &WebviewWindow) -> bool {
    true
}

pub fn set_desktop_icons_visible(_visible: bool) {}

pub fn refresh_wallpaper() {}
