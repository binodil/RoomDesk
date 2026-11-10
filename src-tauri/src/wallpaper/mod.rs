//! Putting the room windows into the desktop's wallpaper layer.
//!
//! Windows and macOS each have their own version. Other systems get one that
//! does nothing, so the rest of the app compiles everywhere.

#[cfg(windows)]
mod windows_impl;
#[cfg(windows)]
pub use windows_impl::*;

#[cfg(target_os = "macos")]
mod macos_impl;
#[cfg(target_os = "macos")]
pub use macos_impl::*;

#[cfg(not(any(windows, target_os = "macos")))]
mod other;
#[cfg(not(any(windows, target_os = "macos")))]
pub use other::*;

/// How a room window ended up attached.
#[derive(Debug, Clone, PartialEq)]
// Each system uses only some of these.
#[allow(dead_code)]
pub enum Mode {
    /// Windows 11 24H2 and newer (including 25H2): child of Progman, under the desktop icons.
    NewLayout,
    /// Older Windows: child of the WorkerW window that draws the wallpaper.
    OldLayout,
    /// macOS: just above Finder's desktop icons, behind every app, on every Space.
    MacDesktop,
    /// Could not attach. The window stays a normal window kept behind all others.
    Fallback(String),
}

impl Mode {
    pub fn describe(&self) -> String {
        match self {
            Mode::NewLayout => "behind desktop icons (Windows 24H2+ method)".into(),
            Mode::OldLayout => "behind desktop icons (classic method)".into(),
            Mode::MacDesktop => "on the desktop, behind all windows".into(),
            Mode::Fallback(why) => format!("normal window kept at the back ({why})"),
        }
    }
}
