# RoomDesk

Your Windows desktop as a 3D room. Desktop items (app icons, files, sticky notes,
pictures, a map, a whiteboard, a mirror and more) live on the walls and floor, in
correct perspective, and you can click and use them.

RoomDesk is an open-source replacement for BumpTop, built with
[Tauri 2](https://tauri.app) (Rust + WebView2) and TypeScript.
It targets Windows 11 first, with macOS planned later.

> **Status:** early development. Milestone 1, step 1: the project builds and opens
> a test window that lists your monitors.

## Run it on Windows

### 1. One-time setup

Open **Terminal** (right-click Start → Terminal) and install the tools:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install Rustlang.Rustup
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close the Terminal and open a new one, then check that they work:

```powershell
rustc --version
node --version
git --version
```

WebView2 is already part of Windows 11.

### 2. Get the code

```powershell
cd $HOME\Documents
git clone https://github.com/binodil/RoomDesk.git
cd RoomDesk
npm install
```

### 3. Start the app

```powershell
npm run tauri dev
```

The first start compiles the Rust code and takes a few minutes. Later starts are
much faster. A window titled **RoomDesk** opens and shows a table of your monitors.
Close the window to stop the app.

### Get the newest version later

```powershell
cd $HOME\Documents\RoomDesk
git pull
npm install
npm run tauri dev
```

### Build an installer (optional)

```powershell
npm run tauri build
```

The installer appears in `src-tauri\target\release\bundle\nsis\`.

## Project layout

```
index.html, src/        The web page that draws the room (TypeScript)
src-tauri/              The Rust side: windows, wallpaper layer, tray, files
src-tauri/tauri.conf.json   App settings (name, window, installer)
```

## Plan

1. Window in the wallpaper layer showing a photo on every monitor; tray icon; clean exit
2. Photo room calibration with a perspective-correct test grid
3. App icons, shortcuts and files: add, drag, launch, save layout
4. Sticky notes, stickers, images, whiteboard, mirror, plant / rose / apple that change over time
5. Map widget
6. Virtual 3D room with templates and parallax
7. Polish: autostart, fullscreen pause, installer, backup and export

## License

MIT, see [LICENSE](LICENSE).
