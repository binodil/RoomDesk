//! The Recycle Bin: how full it is, and opening it in File Explorer.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct BinState {
    /// Number of files and folders in the bin (all drives).
    pub items: i64,
    /// Their total size in bytes.
    pub bytes: i64,
}

#[cfg(windows)]
pub fn state() -> Result<BinState, String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    // A null root path means "every drive".
    unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) }.map_err(|e| e.to_string())?;
    Ok(BinState { items: info.i64NumItems, bytes: info.i64Size })
}

#[cfg(not(windows))]
pub fn state() -> Result<BinState, String> {
    Ok(BinState::default())
}

/// Open the Recycle Bin window, the same as double-clicking it on the desktop.
pub fn open() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg("shell:RecycleBinFolder")
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Err("the Recycle Bin is only available on Windows".into())
    }
}
