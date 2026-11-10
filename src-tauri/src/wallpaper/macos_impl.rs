//! macOS: make each room window part of the desktop.
//!
//! macOS stacks windows in "levels". The wallpaper is at the bottom, Finder's
//! desktop icons sit a little above it, and every normal app window is far above
//! both. A room window goes into one of two places:
//!
//! - **Icons shown** (the default, like Windows): just above the wallpaper and
//!   below Finder's icons. Finder then takes the clicks, so `input::mac_tap`
//!   catches the clicks meant for room items.
//! - **Icons hidden** (tray → Hide desktop icons): just above Finder's icons, so
//!   the room covers them and gets clicks directly.
//!
//! Either way it stays behind every app window, joins every Space (virtual
//! desktop), stays still in Mission Control and "Show Desktop", and is skipped
//! by Cmd + `.
//!
//! AppKit must only be touched on the main thread. Tauri's own level changes
//! (always on top / bottom) go through the main dispatch queue, so ours do too:
//! that queue runs jobs in order, so the last change asked for is the one that sticks.

use std::sync::atomic::{AtomicBool, Ordering};

use super::Mode;
use dispatch2::DispatchQueue;
use objc2::{msg_send, rc::Retained, runtime::AnyObject};
use tauri::WebviewWindow;

// From CoreGraphics: the level of a named layer of the screen.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowLevelForKey(key: i32) -> i32;
}
/// `kCGDesktopWindowLevelKey`: the wallpaper's layer.
const DESKTOP_LEVEL_KEY: i32 = 2;
/// `kCGDesktopIconWindowLevelKey`: the layer with Finder's desktop icons.
const DESKTOP_ICON_LEVEL_KEY: i32 = 18;

/// Whether Finder's icons are shown on top of the room.
static ICONS_VISIBLE: AtomicBool = AtomicBool::new(true);

pub fn icons_visible() -> bool {
    ICONS_VISIBLE.load(Ordering::SeqCst)
}
/// `NSNormalWindowLevel`.
const NORMAL_LEVEL: isize = 0;

// NSWindowCollectionBehavior flags.
const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const STATIONARY: usize = 1 << 4;
const IGNORES_CYCLE: usize = 1 << 6;
const FULL_SCREEN_NONE: usize = 1 << 9;

/// The room's level: one step above the wallpaper (icons shown) or above Finder's icons (icons hidden).
fn room_level() -> isize {
    let key = if icons_visible() { DESKTOP_LEVEL_KEY } else { DESKTOP_ICON_LEVEL_KEY };
    unsafe { CGWindowLevelForKey(key) as isize + 1 }
}

/// An NSWindow that can be handed to the main thread (only touched there).
struct MainOnly(Retained<AnyObject>);
unsafe impl Send for MainOnly {}

/// Run `work` with the window's NSWindow on the main thread. False if the window has none.
fn with_ns_window(window: &WebviewWindow, work: impl FnOnce(&AnyObject) + Send + 'static) -> bool {
    let Ok(ptr) = window.ns_window() else {
        return false;
    };
    // Keep the NSWindow alive until the job has run, even if the room is closed meanwhile.
    let Some(ns_window) = (unsafe { Retained::retain(ptr.cast::<AnyObject>()) }) else {
        return false;
    };
    let ns_window = MainOnly(ns_window);
    DispatchQueue::main().exec_async(move || {
        let ns_window = ns_window;
        work(&ns_window.0);
    });
    true
}

pub fn attach(window: &WebviewWindow, _x: i32, _y: i32, _w: u32, _h: u32) -> Mode {
    let level = room_level();
    let placed = with_ns_window(window, move |w| unsafe {
        let _: () = msg_send![w, setCollectionBehavior: CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_NONE];
        let _: () = msg_send![w, setLevel: level];
    });
    if placed {
        Mode::MacDesktop
    } else {
        Mode::Fallback("could not reach the macOS window".into())
    }
}

/// Bring a room back to the normal level for editing (the caller then puts it on top).
pub fn detach(window: &WebviewWindow, _x: i32, _y: i32, _w: u32, _h: u32) {
    with_ns_window(window, |w| unsafe {
        let _: () = msg_send![w, setLevel: NORMAL_LEVEL];
    });
}

/// macOS never takes a room window away from its level (unlike Explorer restarting on Windows).
pub fn is_attached(_window: &WebviewWindow) -> bool {
    true
}

/// Show Finder's icons on top of the room, or let the room cover them. Finder itself
/// is left alone; the rooms change level the next time they are placed (see `monitors::resync`).
pub fn set_desktop_icons_visible(visible: bool) {
    ICONS_VISIBLE.store(visible, Ordering::SeqCst);
}

pub fn refresh_wallpaper() {}
