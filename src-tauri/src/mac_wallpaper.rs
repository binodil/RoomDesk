//! macOS: show the room photo as the real Mac wallpaper too.
//!
//! When you swipe between Spaces, macOS slides the next Space's wallpaper in
//! and only moves windows that are on every Space (like the rooms) across
//! halfway through. With the room photo as the Mac wallpaper, the swipe shows
//! the room right away and only the items appear a moment later.
//!
//! Each Space has its own wallpaper, so RoomDesk sets it on start and again
//! whenever you arrive on another Space, and whenever you pick another photo.

use std::{fs, path::PathBuf, ptr::NonNull};

use block2::RcBlock;
use objc2::{runtime::AnyObject, MainThreadMarker};
use objc2_app_kit::{
    NSScreen, NSWorkspace, NSWorkspaceActiveSpaceDidChangeNotification, NSWorkspaceDesktopImageAllowClippingKey,
    NSWorkspaceDesktopImageScalingKey,
};
use objc2_foundation::{NSDictionary, NSNotification, NSNumber, NSOperationQueue, NSString, NSURL};
use tauri::AppHandle;

use crate::settings;

/// The built-in sample room, written to a file the first time it is needed.
const SAMPLE_ROOM: &[u8] = include_bytes!("../../public/default-room.jpg");
/// `NSImageScaleProportionallyUpOrDown`: with clipping allowed, this is "Fill Screen".
const FILL: isize = 3;

/// The room photo as a file.
fn photo_path(app: &AppHandle) -> Option<PathBuf> {
    match settings::load(app).photo {
        Some(p) if p.exists() => Some(p),
        _ => {
            let p = settings::data_folder(app).ok()?.join("sample-room.jpg");
            if !p.exists() {
                fs::write(&p, SAMPLE_ROOM).ok()?;
            }
            Some(p)
        }
    }
}

/// Set this Space's wallpaper to the room photo on every screen.
fn apply_now(app: &AppHandle, mtm: MainThreadMarker) {
    let Some(path) = photo_path(app) else {
        return;
    };
    let path = path.to_string_lossy().into_owned();
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
    let fill = NSNumber::new_isize(FILL);
    let clip = NSNumber::new_bool(true);
    let (fill, clip): (&AnyObject, &AnyObject) = (&fill, &clip);
    let options = unsafe {
        NSDictionary::from_slices(&[NSWorkspaceDesktopImageScalingKey, NSWorkspaceDesktopImageAllowClippingKey], &[fill, clip])
    };
    let workspace = NSWorkspace::sharedWorkspace();
    for screen in NSScreen::screens(mtm).iter() {
        // Already the room? Setting it again would make the screen flash.
        let current = workspace.desktopImageURLForScreen(&screen).and_then(|u| u.path()).map(|p| p.to_string());
        if current.as_deref() == Some(path.as_str()) {
            continue;
        }
        if let Err(e) = unsafe { workspace.setDesktopImageURL_forScreen_options_error(&url, &screen, &options) } {
            eprintln!("RoomDesk: could not set the Mac wallpaper: {e:?}");
        }
    }
}

/// Set the wallpaper to the room photo (from any thread).
pub fn apply(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(mtm) = MainThreadMarker::new() {
            apply_now(&handle, mtm);
        }
    });
}

/// Set it now, and again each time another Space comes into view.
pub fn start(app: &AppHandle) {
    apply(app);
    let handle = app.clone();
    let block = RcBlock::new(move |_note: NonNull<NSNotification>| apply(&handle));
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceActiveSpaceDidChangeNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    // Keep listening for as long as RoomDesk runs.
    std::mem::forget(observer);
}
