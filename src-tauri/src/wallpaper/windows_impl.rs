//! Windows implementation.
//!
//! How the desktop is built (simplified):
//!
//! * **Windows 11 24H2 and newer (24H2, 25H2):** the `Progman` window holds two
//!   children: `SHELLDLL_DefView` (the desktop icons, on top) and `WorkerW`
//!   (the wallpaper, at the bottom). We make our room window a child of `Progman`
//!   and slot it *between* them: above the wallpaper, below the icons.
//! * **Older Windows:** after a special message, Explorer creates a separate
//!   top-level `WorkerW` window behind the icons that draws the wallpaper.
//!   We make our room window a child of that `WorkerW`.
//!
//! If neither works, the caller keeps the room as an ordinary window that
//! stays behind all other windows, so the app still works.

use super::Mode;
use tauri::WebviewWindow;
use windows::core::{w, BOOL};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetParent, GetSystemMetrics, GetWindowLongPtrW,
    IsWindow, SendMessageTimeoutW, SetLayeredWindowAttributes, SetParent, SetWindowLongPtrW,
    SetWindowPos, ShowWindow, SystemParametersInfoW, GWL_EXSTYLE, GWL_STYLE, LWA_ALPHA,
    SMTO_NORMAL, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SPI_GETDESKWALLPAPER,
    SPI_SETDESKWALLPAPER, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, SW_SHOW,
    SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WS_CHILD, WS_EX_LAYERED, WS_POPUP,
};

/// Undocumented message that asks Explorer to create the wallpaper `WorkerW`.
/// Used by Wallpaper Engine, Lively and others for years.
const SPAWN_WORKERW: u32 = 0x052C;

fn hwnd_of(window: &WebviewWindow) -> Option<HWND> {
    window.hwnd().ok().map(|h| HWND(h.0))
}

fn progman() -> Option<HWND> {
    unsafe { FindWindowW(w!("Progman"), None).ok() }
}

/// Ask Explorer to create the wallpaper WorkerW (harmless if it already exists).
fn spawn_workerw(progman: HWND) {
    unsafe {
        let mut result = 0usize;
        let _ = SendMessageTimeoutW(progman, SPAWN_WORKERW, WPARAM(0xD), LPARAM(0x1), SMTO_NORMAL, 1000, Some(&mut result));
        let _ = SendMessageTimeoutW(progman, SPAWN_WORKERW, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, Some(&mut result));
    }
}

/// Old layout: the top-level WorkerW that comes right after the window holding the icons.
fn find_old_workerw() -> Option<HWND> {
    unsafe extern "system" fn visit(top: HWND, lparam: LPARAM) -> BOOL {
        let found = lparam.0 as *mut Option<HWND>;
        if FindWindowExW(Some(top), None, w!("SHELLDLL_DefView"), None).is_ok() {
            if let Ok(worker) = FindWindowExW(None, Some(top), w!("WorkerW"), None) {
                *found = Some(worker);
                return BOOL(0); // stop
            }
        }
        BOOL(1) // keep looking
    }
    let mut found: Option<HWND> = None;
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut found as *mut _ as isize));
    }
    found
}

/// The SHELLDLL_DefView window (the one that shows desktop icons), wherever Explorer put it.
fn find_defview() -> Option<HWND> {
    unsafe {
        if let Some(pm) = progman() {
            if let Ok(dv) = FindWindowExW(Some(pm), None, w!("SHELLDLL_DefView"), None) {
                return Some(dv);
            }
        }
        // Old layout: it may live inside a top-level WorkerW instead.
        let mut after: Option<HWND> = None;
        while let Ok(worker) = FindWindowExW(None, after, w!("WorkerW"), None) {
            if let Ok(dv) = FindWindowExW(Some(worker), None, w!("SHELLDLL_DefView"), None) {
                return Some(dv);
            }
            after = Some(worker);
        }
    }
    None
}

/// Turn our window into a child window (required before SetParent).
fn make_child(hwnd: HWND, layered: bool) {
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let style = (style & !(WS_POPUP.0 as isize)) | WS_CHILD.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_STYLE, style);
        if layered {
            // On 24H2+ children of Progman must be layered to be drawn.
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) | WS_EX_LAYERED.0 as isize;
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
            let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
        }
    }
}

/// Attach `window` to the wallpaper layer and place it over the monitor at
/// (`x`, `y`) with size `w` × `h`, all in physical screen pixels.
pub fn attach(window: &WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> Mode {
    let Some(hwnd) = hwnd_of(window) else {
        return Mode::Fallback("no window handle".into());
    };
    let Some(pm) = progman() else {
        return Mode::Fallback("Explorer's desktop (Progman) not found".into());
    };
    spawn_workerw(pm);

    // Child windows are placed relative to the parent, whose top-left corner is
    // the top-left of the whole virtual screen (it can be negative with a monitor
    // to the left of or above the main one).
    let (vx, vy) = unsafe { (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN)) };
    let (cx, cy) = (x - vx, y - vy);

    unsafe {
        // New layout (24H2 / 25H2): WorkerW is a child of Progman.
        if FindWindowExW(Some(pm), None, w!("WorkerW"), None).is_ok() {
            let defview = FindWindowExW(Some(pm), None, w!("SHELLDLL_DefView"), None).ok();
            make_child(hwnd, true);
            if SetParent(hwnd, Some(pm)).is_ok() {
                // Insert right below the icons, which also keeps us above the wallpaper.
                let _ = SetWindowPos(hwnd, defview, cx, cy, w as i32, h as i32, SWP_NOACTIVATE | SWP_SHOWWINDOW);
                return Mode::NewLayout;
            }
        }

        // Old layout: a separate top-level WorkerW draws the wallpaper.
        if let Some(worker) = find_old_workerw() {
            make_child(hwnd, false);
            if SetParent(hwnd, Some(worker)).is_ok() {
                let _ = SetWindowPos(hwnd, None, cx, cy, w as i32, h as i32, SWP_NOACTIVATE | SWP_SHOWWINDOW);
                return Mode::OldLayout;
            }
        }
    }
    Mode::Fallback("Explorer's wallpaper window not found".into())
}

/// Take the window back out of the desktop, as a normal top-level window placed
/// over the monitor at (`x`, `y`) with size `w` × `h` (used while calibrating).
pub fn detach(window: &WebviewWindow, x: i32, y: i32, w: u32, h: u32) {
    let Some(hwnd) = hwnd_of(window) else { return };
    unsafe {
        let _ = SetParent(hwnd, None);
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let style = (style & !(WS_CHILD.0 as isize)) | WS_POPUP.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_STYLE, style);
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & !(WS_EX_LAYERED.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
        let _ = SetWindowPos(hwnd, None, x, y, w as i32, h as i32, SWP_SHOWWINDOW);
    }
}

/// Still a child of a living Explorer window? (False after Explorer restarts.)
pub fn is_attached(window: &WebviewWindow) -> bool {
    let Some(hwnd) = hwnd_of(window) else { return false };
    unsafe {
        match GetParent(hwnd) {
            Ok(parent) => IsWindow(Some(parent)).as_bool(),
            Err(_) => false,
        }
    }
}

/// Show or hide the normal Windows desktop icons.
pub fn set_desktop_icons_visible(visible: bool) {
    unsafe {
        let Some(defview) = find_defview() else { return };
        if let Ok(list) = FindWindowExW(Some(defview), None, w!("SysListView32"), None) {
            let _ = ShowWindow(list, if visible { SW_SHOW } else { SW_HIDE });
        }
    }
}

/// Make Explorer redraw the user's normal wallpaper (used when RoomDesk exits).
pub fn refresh_wallpaper() {
    unsafe {
        let mut buf = [0u16; 1024];
        let got = SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr() as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
        // Only re-apply a real picture path. An empty path would remove the wallpaper.
        if got.is_ok() && buf[0] != 0 {
            let _ = SystemParametersInfoW(
                SPI_SETDESKWALLPAPER,
                0,
                Some(buf.as_mut_ptr() as *mut _),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            );
        }
    }
}
