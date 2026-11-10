//! macOS: make each room window part of the desktop.
//!
//! macOS stacks windows in "levels". The wallpaper is at the bottom, Finder's
//! desktop icons sit a little above it, and every normal app window is far above
//! both. A room window is placed just above Finder's icons, so it:
//!
//! - covers the wallpaper and Finder's icons (your room items replace them),
//! - stays behind every app window, and
//! - gets mouse clicks directly, with no mouse hook (Windows needs one).
//!
//! It also joins every Space (virtual desktop), stays still in Mission Control
//! and "Show Desktop", and is skipped by Cmd + `.
//!
//! AppKit must only be touched on the main thread. Tauri's own level changes
//! (always on top / bottom) go through the main dispatch queue, so ours do too:
//! that queue runs jobs in order, so the last change asked for is the one that sticks.

use super::Mode;
use dispatch2::DispatchQueue;
use objc2::{msg_send, rc::Retained, runtime::AnyObject};
use tauri::WebviewWindow;

// From CoreGraphics: the level of a named layer of the screen.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowLevelForKey(key: i32) -> i32;
}
/// `kCGDesktopIconWindowLevelKey`: the layer with Finder's desktop icons.
const DESKTOP_ICON_LEVEL_KEY: i32 = 18;
/// `NSNormalWindowLevel`.
const NORMAL_LEVEL: isize = 0;

// NSWindowCollectionBehavior flags.
const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const STATIONARY: usize = 1 << 4;
const IGNORES_CYCLE: usize = 1 << 6;
const FULL_SCREEN_NONE: usize = 1 << 9;

/// The room's level: one step above Finder's icons, far below every app.
fn room_level() -> isize {
    unsafe { CGWindowLevelForKey(DESKTOP_ICON_LEVEL_KEY) as isize + 1 }
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

/// The room already covers Finder's icons. Truly hiding them would mean restarting Finder.
pub fn set_desktop_icons_visible(_visible: bool) {}

pub fn refresh_wallpaper() {}
