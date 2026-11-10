//! Putting the room windows into the desktop's wallpaper layer.
//!
//! Only Windows has a real implementation for now. Other systems (macOS later)
//! get a version that does nothing, so the rest of the app compiles everywhere.

#[cfg(windows)]
mod windows_impl;
#[cfg(windows)]
pub use windows_impl::*;

#[cfg(not(windows))]
mod other;
#[cfg(not(windows))]
pub use other::*;

/// How a room window ended up attached.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum Mode {
    /// Windows 11 24H2 and newer (including 25H2): child of Progman, under the desktop icons.
    NewLayout,
    /// Older Windows: child of the WorkerW window that draws the wallpaper.
    OldLayout,
    /// Could not attach. The window stays a normal window kept behind all others.
    Fallback(String),
}

impl Mode {
    pub fn describe(&self) -> String {
        match self {
            Mode::NewLayout => "behind desktop icons (Windows 24H2+ method)".into(),
            Mode::OldLayout => "behind desktop icons (classic method)".into(),
            Mode::Fallback(why) => format!("normal window kept at the back ({why})"),
        }
    }
}
