//! The tray icon (bottom-right of the taskbar on Windows, top-right of the menu bar on a Mac) and its menu.

use std::thread;

use tauri::{
    menu::{CheckMenuItem, MenuBuilder, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};

use tauri_plugin_opener::OpenerExt;

use crate::{monitors, settings, system, wallpaper};

const HOMEPAGE: &str = "https://github.com/binodil/RoomDesk";

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
    let edit = MenuItem::with_id(app, "edit", "Edit items…", true, None::<&str>)?;
    let calibrate = MenuItem::with_id(app, "calibrate", "Calibrate room…", true, None::<&str>)?;
    let grid = CheckMenuItem::with_id(app, "grid", "Show test grid", true, saved.show_grid, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pause", true, false, None::<&str>)?;
    let hide_icons =
        CheckMenuItem::with_id(app, "hide_icons", "Hide desktop icons", true, saved.hide_icons, None::<&str>)?;
    let autostart =
        CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, system::autostart_enabled(), None::<&str>)?;
    let version = app.package_info().version.to_string();
    let about = MenuItem::with_id(app, "about", format!("About RoomDesk {version}"), true, None::<&str>)?;
    // Macs say "Quit" where Windows says "Exit".
    let exit_text = if cfg!(target_os = "macos") { "Quit RoomDesk" } else { "Exit RoomDesk" };
    let exit = MenuItem::with_id(app, "exit", exit_text, true, None::<&str>)?;

    let mut builder = MenuBuilder::new(app)
        .items(&[&status, &screens])
        .separator()
        .item(&edit)
        .separator()
        .items(&[&choose, &sample])
        .separator()
        .items(&[&calibrate, &grid])
        .separator()
        .item(&pause);
    // Hiding desktop icons and starting with the system are Windows-only for now,
    // so a Mac doesn't show switches that do nothing.
    if cfg!(windows) {
        builder = builder.items(&[&hide_icons, &autostart]);
    }
    let menu = builder.separator().items(&[&about, &exit]).build()?;

    let pause_item = pause.clone();
    let hide_item = hide_icons.clone();
    let grid_item = grid.clone();
    let autostart_item = autostart.clone();
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
            "edit" => crate::start_front_mode(app, "edit"),
            "calibrate" => crate::start_front_mode(app, "calibrate"),
            "grid" => {
                let show = grid_item.is_checked().unwrap_or(true);
                crate::set_show_grid(app, show);
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
            "autostart" => {
                let on = autostart_item.is_checked().unwrap_or(false);
                if let Err(e) = system::set_autostart(on) {
                    eprintln!("RoomDesk: {e}");
                    let _ = autostart_item.set_checked(system::autostart_enabled());
                }
            }
            "about" => {
                let _ = app.opener().open_url(HOMEPAGE, None::<&str>);
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
