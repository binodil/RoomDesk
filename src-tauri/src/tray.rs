//! The tray icon (bottom-right of the taskbar) and its menu.

use std::thread;

use tauri::{
    menu::{CheckMenuItem, MenuBuilder, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};

use crate::{monitors, settings, wallpaper};

struct TrayItems {
    status: MenuItem<Wry>,
    monitors: MenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let saved = settings::load(app);

    let status = MenuItem::with_id(app, "status", "Room: starting…", false, None::<&str>)?;
    let screens = MenuItem::with_id(app, "monitors", "Monitors: …", false, None::<&str>)?;
    let choose = MenuItem::with_id(app, "choose", "Choose room photo…", true, None::<&str>)?;
    let sample = MenuItem::with_id(app, "sample", "Use sample room", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pause", true, false, None::<&str>)?;
    let hide_icons =
        CheckMenuItem::with_id(app, "hide_icons", "Hide desktop icons", true, saved.hide_icons, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Exit RoomDesk", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .items(&[&status, &screens])
        .separator()
        .items(&[&choose, &sample])
        .separator()
        .items(&[&pause, &hide_icons])
        .separator()
        .item(&exit)
        .build()?;

    let pause_item = pause.clone();
    let hide_item = hide_icons.clone();
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("app icon".into()))?;

    TrayIconBuilder::with_id("roomdesk")
        .icon(icon)
        .tooltip("RoomDesk")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "choose" => {
                // The file picker waits for the user, so run it off the main thread.
                let app = app.clone();
                thread::spawn(move || {
                    if let Err(e) = crate::pick_photo(&app) {
                        eprintln!("RoomDesk: {e}");
                    }
                });
            }
            "sample" => {
                if let Err(e) = crate::use_sample_room(app) {
                    eprintln!("RoomDesk: {e}");
                }
            }
            "pause" => {
                let paused = pause_item.is_checked().unwrap_or(false);
                monitors::set_paused(app, paused);
            }
            "hide_icons" => {
                let hide = hide_item.is_checked().unwrap_or(false);
                wallpaper::set_desktop_icons_visible(!hide);
                let mut s = settings::load(app);
                s.hide_icons = hide;
                if let Err(e) = settings::save(app, &s) {
                    eprintln!("RoomDesk: {e}");
                }
            }
            "exit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    app.manage(TrayItems { status, monitors: screens });
    Ok(())
}

/// Update the two information lines at the top of the tray menu.
pub fn set_info(app: &AppHandle, status: &str, monitors: &str) {
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.status.set_text(status);
        let _ = items.monitors.set_text(monitors);
    }
}
