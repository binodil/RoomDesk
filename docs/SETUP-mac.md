# Setup on a Mac (early test version)

The Mac version is a work in progress. RoomDesk becomes your desktop: the room
sits behind every app window and Finder's desktop icons, on every monitor and
every Space (virtual desktop). Menu bar icon → **Hide desktop icons** lets the
room cover Finder's icons instead.

You need macOS 13 (Ventura) or newer. Apple Silicon (M1 and later) and Intel Macs both work.

## 1. One-time setup

Open **Terminal** (press Cmd + Space, type `Terminal`, press Return) and run these one at a time.

Apple's developer tools (they include `git`). A window pops up: click **Install** and wait until it finishes:

```bash
xcode-select --install
```

Rust. When it asks, press Return to choose the default install:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Node.js: download the **LTS** installer (the `.pkg` file) from [nodejs.org](https://nodejs.org) and open it.

Close Terminal completely (Cmd + Q), open it again, and check that everything works:

```bash
rustc --version
node --version
git --version
```

Each line should print a version number.

## 2. Get the code

```bash
cd ~/Documents
git clone https://github.com/binodil/RoomDesk.git
cd RoomDesk
npm install
```

## 3. Start the app

```bash
npm run tauri dev
```

The first start compiles the Rust code and takes a few minutes. Later starts are much faster.

RoomDesk has no Dock icon. Look for its cube icon in the **menu bar at the top right** of the screen.
Everything is in its menu. **Quit RoomDesk** stops it (or press Ctrl + C in Terminal).

### Allow RoomDesk to catch clicks (one time)

While Finder's icons are shown, Finder sits on top of the room and takes every click.
To still open room items with a click, RoomDesk needs **Accessibility** permission.
macOS asks the first time: click **Open System Settings**, then turn on the switch for
**Terminal** (while you run RoomDesk from Terminal) or **RoomDesk** (the built app).
If you missed the question, go to System Settings → Privacy & Security → Accessibility.
RoomDesk usually notices within a few seconds; if clicks still do nothing, quit RoomDesk and start it again.

With **Hide desktop icons** on, no permission is needed.

## Get the newest version later

```bash
cd ~/Documents/RoomDesk
git pull
npm install
npm run tauri dev
```

## Build the app (optional)

```bash
npm run tauri build
```

`RoomDesk.app` and a `.dmg` appear in `src-tauri/target/release/bundle/`.
This build isn't signed yet, so the first time you open it, right-click it and choose **Open**.
