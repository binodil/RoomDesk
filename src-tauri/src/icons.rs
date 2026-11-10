//! Icons and thumbnails for files, folders and shortcuts, plus basic facts
//! about a dropped path (its display name and what kind of item it is).

use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInfo {
    pub path: String,
    pub name: String,
    /// "folder", "shortcut", "app" or "file".
    pub kind: String,
}

/// Name and kind for a path, as shown under the item in the room.
pub fn describe(path: &str) -> ItemInfo {
    let p = Path::new(path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let kind = match ext.as_str() {
        // A Mac app ("Safari.app") is really a folder, so check for it first.
        "app" => "app",
        _ if p.is_dir() => "folder",
        "lnk" | "url" | "webloc" => "shortcut",
        "exe" | "appref-ms" => "app",
        _ => "file",
    };
    // Shortcuts and apps read better without ".lnk" / ".exe" / ".app", like on the desktop.
    let name = if kind == "shortcut" || kind == "app" {
        p.file_stem()
    } else {
        p.file_name()
    }
    .and_then(|n| n.to_str())
    .map(str::to_owned)
    .unwrap_or_else(|| path.to_owned());
    ItemInfo { path: path.to_owned(), name, kind: kind.to_owned() }
}

/// Turn raw RGBA pixels into PNG bytes.
#[cfg_attr(not(windows), allow(dead_code))]
fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// The Windows icon or thumbnail for `path` as PNG bytes, about `size` pixels.
#[cfg(windows)]
pub fn icon_png(path: &str, size: i32) -> Result<Vec<u8>, String> {
    use std::{ffi::c_void, mem::size_of};
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
        BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK};

    unsafe {
        // Shell calls need COM on this thread (harmless if it is already set up).
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let wide = HSTRING::from(path);
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).map_err(|e| e.to_string())?;
        let hbmp = factory
            .GetImage(SIZE { cx: size, cy: size }, SIIGBF_BIGGERSIZEOK)
            .map_err(|e| e.to_string())?;

        let mut bm = BITMAP::default();
        GetObjectW(hbmp.into(), size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut c_void));
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        if w <= 0 || h <= 0 {
            let _ = DeleteObject(hbmp.into());
            return Err("empty image".into());
        }

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // negative = rows from top to bottom
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (w * h * 4) as usize];
        let hdc = GetDC(None);
        let lines = GetDIBits(hdc, hbmp, 0, h as u32, Some(pixels.as_mut_ptr() as *mut c_void), &mut info, DIB_RGB_COLORS);
        ReleaseDC(None, hdc);
        let _ = DeleteObject(hbmp.into());
        if lines == 0 {
            return Err("could not read image".into());
        }

        // Windows gives blue-green-red-alpha with colours pre-multiplied by alpha.
        // Photos often have no alpha at all (all zero), which means "fully opaque".
        let has_alpha = pixels.as_chunks::<4>().0.iter().any(|p| p[3] != 0);
        for p in pixels.as_chunks_mut::<4>().0 {
            p.swap(0, 2);
            if !has_alpha {
                p[3] = 255;
            } else if p[3] > 0 && p[3] < 255 {
                let a = p[3] as u32;
                for c in &mut p[..3] {
                    *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
        if has_alpha {
            let (cw, ch, cropped) = trim_to_square(w as usize, h as usize, &pixels);
            return encode_png(cw as u32, ch as u32, &cropped);
        }
        encode_png(w as u32, h as u32, &pixels)
    }
}

/// Many programs only ship small icons, which Windows centres in an otherwise
/// empty 256-pixel image. Cut away the empty border (keeping the icon square
/// and a little margin), so every icon fills its tile in the room.
#[cfg_attr(not(windows), allow(dead_code))]
fn trim_to_square(w: usize, h: usize, rgba: &[u8]) -> (usize, usize, Vec<u8>) {
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0usize, 0usize);
    for y in 0..h {
        for x in 0..w {
            if rgba[(y * w + x) * 4 + 3] > 8 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    if x0 > x1 || y0 > y1 {
        return (w, h, rgba.to_vec()); // fully transparent
    }
    let content = (x1 - x0 + 1).max(y1 - y0 + 1);
    let side = (content + content / 16).min(w.max(h));
    if side * 10 >= w.min(h) * 9 {
        return (w, h, rgba.to_vec()); // already fills the image
    }
    let cx = (x0 + x1) as isize / 2;
    let cy = (y0 + y1) as isize / 2;
    let left = cx - side as isize / 2;
    let top = cy - side as isize / 2;
    let mut out = vec![0u8; side * side * 4];
    for y in 0..side {
        let sy = top + y as isize;
        if sy < 0 || sy >= h as isize {
            continue;
        }
        for x in 0..side {
            let sx = left + x as isize;
            if sx < 0 || sx >= w as isize {
                continue;
            }
            let src = (sy as usize * w + sx as usize) * 4;
            let dst = (y * side + x) * 4;
            out[dst..dst + 4].copy_from_slice(&rgba[src..src + 4]);
        }
    }
    (side, side, out)
}

/// The macOS icon for `path` (the same one Finder shows) as PNG bytes, `size` pixels square.
#[cfg(target_os = "macos")]
pub fn icon_png(path: &str, size: i32) -> Result<Vec<u8>, String> {
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

    objc2::rc::autoreleasepool(|_| {
        let image = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(path));
        let side = size as f64;
        image.setSize(NSSize::new(side, side));
        let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(side, side));
        // Ask for the icon drawn at exactly this size (icons hold several sizes).
        let cg = unsafe { image.CGImageForProposedRect_context_hints(&mut rect, None, None) }
            .ok_or("macOS gave no icon")?;
        let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg);
        let png = unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }
            .ok_or("could not turn the icon into a PNG")?;
        Ok(png.to_vec())
    })
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn icon_png(_path: &str, _size: i32) -> Result<Vec<u8>, String> {
    Err("icons are only available on Windows and macOS".into())
}

#[cfg(test)]
mod tests {
    use super::{describe, trim_to_square};

    #[test]
    fn mac_app_is_an_app_not_a_folder() {
        let dir = std::env::temp_dir().join("roomdesk-test").join("Notes.app");
        std::fs::create_dir_all(&dir).unwrap();
        let info = describe(&dir.to_string_lossy());
        assert_eq!(info.kind, "app");
        assert_eq!(info.name, "Notes");
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn windows_shortcut_and_mac_link() {
        assert_eq!(describe(r"C:\Users\me\Desktop\Game.lnk").kind, "shortcut");
        assert_eq!(describe("/Users/me/Desktop/News.webloc").kind, "shortcut");
        assert_eq!(describe("/Users/me/Desktop/News.webloc").name, "News");
    }

    #[test]
    fn small_icon_in_big_image_is_cropped() {
        let (w, h) = (256, 256);
        let mut img = vec![0u8; w * h * 4];
        for y in 112..144 {
            for x in 112..144 {
                img[(y * w + x) * 4 + 3] = 255;
            }
        }
        let (cw, ch, out) = trim_to_square(w, h, &img);
        assert_eq!((cw, ch), (34, 34));
        assert_eq!(out.len(), 34 * 34 * 4);
        assert_eq!(out[(17 * 34 + 17) * 4 + 3], 255);
    }

    #[test]
    fn full_image_is_left_alone() {
        let img = vec![255u8; 64 * 64 * 4];
        assert_eq!(trim_to_square(64, 64, &img).0, 64);
    }
}
