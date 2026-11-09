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
    let kind = if p.is_dir() {
        "folder"
    } else {
        match ext.as_str() {
            "lnk" | "url" => "shortcut",
            "exe" | "appref-ms" => "app",
            _ => "file",
        }
    };
    // Shortcuts and apps read better without ".lnk" / ".exe", like on the desktop.
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
        let has_alpha = pixels.chunks_exact(4).any(|p| p[3] != 0);
        for p in pixels.chunks_exact_mut(4) {
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
        encode_png(w as u32, h as u32, &pixels)
    }
}

#[cfg(not(windows))]
pub fn icon_png(_path: &str, _size: i32) -> Result<Vec<u8>, String> {
    Err("icons are only available on Windows for now".into())
}
