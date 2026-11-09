# Setup on Windows

## 1. One-time setup

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

## 2. Get the code

```powershell
cd $HOME\Documents
git clone https://github.com/binodil/RoomDesk.git
cd RoomDesk
npm install
```

## 3. Start the app

```powershell
npm run tauri dev
```

The first start compiles the Rust code and takes a few minutes. Later starts are
much faster. A window titled **RoomDesk** opens and shows a table of your monitors.
Close the window to stop the app.

## Get the newest version later

```powershell
cd $HOME\Documents\RoomDesk
git pull
npm install
npm run tauri dev
```

## Build an installer (optional)

```powershell
npm run tauri build
```

The installer appears in `src-tauri\target\release\bundle\nsis\`.

