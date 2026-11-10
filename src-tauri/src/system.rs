//! Small pieces of Windows integration: starting with Windows, and noticing
//! when a game, video or presentation fills the screen.

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE: &str = "RoomDesk";

/// Whether RoomDesk starts when you sign in to Windows.
#[cfg(windows)]
pub fn autostart_enabled() -> bool {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    let mut size = 0u32;
    let err = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, &HSTRING::from(RUN_KEY), &HSTRING::from(VALUE), RRF_RT_REG_SZ, None, None, Some(&mut size))
    };
    err.is_ok()
}

/// Turn starting with Windows on or off (for this user only, no admin rights needed).
#[cfg(windows)]
pub fn set_autostart(on: bool) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let key = HSTRING::from(RUN_KEY);
    let name = HSTRING::from(VALUE);
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let command = format!("\"{}\"", exe.display());
        let wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
        let err = unsafe {
            RegSetKeyValueW(HKEY_CURRENT_USER, &key, &name, REG_SZ.0, Some(wide.as_ptr() as *const _), (wide.len() * 2) as u32)
        };
        err.ok().map_err(|e| e.to_string())
    } else {
        let err = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, &key, &name) };
        // Already gone is fine.
        if err.is_ok() || err.0 == 2 {
            Ok(())
        } else {
            Err(err.to_hresult().message())
        }
    }
}

/// True while something is full-screen (a game, a video, a presentation), so the
/// room can rest: nobody sees it, and the computer needs the power elsewhere.
#[cfg(windows)]
pub fn screen_busy() -> bool {
    use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE,
        Err(_) => false,
    }
}

#[cfg(not(windows))]
pub fn autostart_enabled() -> bool {
    false
}

#[cfg(not(windows))]
pub fn set_autostart(_on: bool) -> Result<(), String> {
    Err("starting with the system is only available on Windows for now".into())
}

#[cfg(not(windows))]
pub fn screen_busy() -> bool {
    false
}
