import { defineConfig } from "vite";

// Settings Tauri expects: a fixed port and no screen clearing, so Rust errors stay visible.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
