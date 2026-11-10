//! macOS: clicking room items while Finder's desktop icons are shown on top.
//!
//! With the icons on top, Finder's icon layer covers the room and takes every
//! click on the desktop. Like the Windows hook, RoomDesk watches left clicks
//! (a Core Graphics "event tap"). A click on bare desktop exactly where a room
//! item is drawn is kept away from Finder and opens the item instead; every
//! other click passes through untouched.
//!
//! macOS only allows this after you tick RoomDesk (or Terminal, while
//! developing) in System Settings → Privacy & Security → Accessibility.
//! RoomDesk asks once, then keeps trying quietly until it is allowed.

use std::{
    ffi::c_void,
    ptr,
    sync::{
        atomic::{AtomicPtr, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use objc2::{msg_send, rc::autoreleasepool, runtime::AnyObject};
use objc2_foundation::NSString;
use tauri::Emitter;

use super::{hit_points, Activate, ACTIVE, APP};

type CFTypeRef = *const c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

type TapCallback = extern "C" fn(proxy: *mut c_void, kind: u32, event: *mut c_void, user: *mut c_void) -> *mut c_void;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(tap: u32, place: u32, options: u32, mask: u64, callback: TapCallback, user: *mut c_void) -> *mut c_void;
    fn CGEventTapEnable(tap: *mut c_void, enable: bool);
    fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CFTypeRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFMachPortCreateRunLoopSource(alloc: CFTypeRef, port: *mut c_void, order: isize) -> *mut c_void;
    fn CFRunLoopGetCurrent() -> *mut c_void;
    fn CFRunLoopAddSource(run_loop: *mut c_void, source: *mut c_void, mode: CFTypeRef);
    fn CFRunLoopRun();
    fn CFRelease(object: CFTypeRef);
    static kCFRunLoopCommonModes: CFTypeRef;
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
    static kAXTrustedCheckOptionPrompt: CFTypeRef;
}

const SESSION_TAP: u32 = 1; // kCGSessionEventTap
const HEAD_INSERT: u32 = 0; // kCGHeadInsertEventTap
const ACTIVE_TAP: u32 = 0; // kCGEventTapOptionDefault (may swallow events)
const LEFT_DOWN: u32 = 1; // kCGEventLeftMouseDown
const LEFT_UP: u32 = 2; // kCGEventLeftMouseUp
const DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;
const ON_SCREEN_ONLY: u32 = 1; // kCGWindowListOptionOnScreenOnly

static TAP: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());
/// The item the left button went down on, waiting for the button to come up.
static PRESSED: Mutex<Option<(usize, String)>> = Mutex::new(None);

/// Is this point (in points, top-left origin) on the bare desktop, not on some app's window?
///
/// Windows are listed front to back. The wallpaper, Finder's icons and the rooms
/// all sit in negative layers; every app window, the Dock and the menu bar are at 0 or above.
fn over_desktop(p: CGPoint) -> bool {
    autoreleasepool(|_| unsafe {
        let list = CGWindowListCopyWindowInfo(ON_SCREEN_ONLY, 0);
        if list.is_null() {
            return false;
        }
        // CFArray and CFDictionary are the same objects as NSArray and NSDictionary.
        let array = &*(list as *const AnyObject);
        let count: usize = msg_send![array, count];
        let layer_key = NSString::from_str("kCGWindowLayer");
        let bounds_key = NSString::from_str("kCGWindowBounds");
        let keys = ["X", "Y", "Width", "Height"].map(NSString::from_str);
        let mut answer = true;
        for i in 0..count {
            let info: *const AnyObject = msg_send![array, objectAtIndex: i];
            let bounds: *const AnyObject = msg_send![&*info, objectForKey: &*bounds_key];
            let layer: *const AnyObject = msg_send![&*info, objectForKey: &*layer_key];
            if bounds.is_null() || layer.is_null() {
                continue;
            }
            let mut v = [0f64; 4];
            for (slot, key) in v.iter_mut().zip(&keys) {
                let n: *const AnyObject = msg_send![&*bounds, objectForKey: &**key];
                if !n.is_null() {
                    *slot = msg_send![&*n, doubleValue];
                }
            }
            let [x, y, w, h] = v;
            if p.x >= x && p.y >= y && p.x < x + w && p.y < y + h {
                let layer: isize = msg_send![&*layer, integerValue];
                answer = layer < 0;
                break;
            }
        }
        CFRelease(list);
        answer
    })
}

extern "C" fn callback(_proxy: *mut c_void, kind: u32, event: *mut c_void, _user: *mut c_void) -> *mut c_void {
    // macOS switches a slow or interrupted tap off; switch it straight back on.
    if kind == DISABLED_BY_TIMEOUT || kind == DISABLED_BY_USER_INPUT {
        let tap = TAP.load(Ordering::SeqCst);
        if !tap.is_null() {
            unsafe { CGEventTapEnable(tap, true) };
        }
        return event;
    }
    if !ACTIVE.load(Ordering::SeqCst) || !crate::wallpaper::icons_visible() {
        return event;
    }
    let p = unsafe { CGEventGetLocation(event) };
    match kind {
        LEFT_DOWN => {
            if let Some(target) = hit_points(p.x, p.y) {
                if over_desktop(p) {
                    *PRESSED.lock().unwrap_or_else(|e| e.into_inner()) = Some(target);
                    return ptr::null_mut(); // keep it from Finder
                }
            }
        }
        LEFT_UP => {
            let pressed = PRESSED.lock().unwrap_or_else(|e| e.into_inner()).take();
            if let Some((monitor, id)) = pressed {
                // Open only if released over the same item (like a normal click).
                if hit_points(p.x, p.y).as_ref().map(|(m, i)| (*m, i.as_str())) == Some((monitor, id.as_str())) {
                    if let Some(app) = APP.get() {
                        let _ = app.emit("item-activate", Activate { monitor, id });
                    }
                }
                return ptr::null_mut();
            }
        }
        _ => {}
    }
    event
}

/// Show macOS's "allow Accessibility" prompt (once per launch at most).
fn ask_for_permission() {
    autoreleasepool(|_| unsafe {
        let key = &*(kAXTrustedCheckOptionPrompt as *const NSString);
        let yes: objc2::rc::Retained<AnyObject> = msg_send![objc2::class!(NSNumber), numberWithBool: true];
        let options: objc2::rc::Retained<AnyObject> =
            msg_send![objc2::class!(NSDictionary), dictionaryWithObject: &*yes, forKey: key];
        AXIsProcessTrustedWithOptions(objc2::rc::Retained::as_ptr(&options) as CFTypeRef);
    });
}

pub fn start() {
    thread::spawn(|| {
        let mut asked = false;
        loop {
            // Only needed (and only asked for) while the icons are shown on top.
            if crate::wallpaper::icons_visible() {
                if unsafe { AXIsProcessTrusted() } {
                    break;
                }
                if !asked {
                    ask_for_permission();
                    asked = true;
                }
            }
            thread::sleep(Duration::from_secs(3));
        }
        unsafe {
            let mask = (1u64 << LEFT_DOWN) | (1u64 << LEFT_UP);
            let tap = CGEventTapCreate(SESSION_TAP, HEAD_INSERT, ACTIVE_TAP, mask, callback, ptr::null_mut());
            if tap.is_null() {
                eprintln!("RoomDesk: could not watch the mouse; room items under Finder's icons won't be clickable");
                return;
            }
            TAP.store(tap, Ordering::SeqCst);
            let source = CFMachPortCreateRunLoopSource(ptr::null(), tap, 0);
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);
            CFRunLoopRun();
        }
    });
}
