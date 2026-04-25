// Elenchus - Electron Vite Configuration
// Three-way build: main process, preload script, and renderer (React GUI).

import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/main",
      rollupOptions: {
        input: resolve(__dirname, "electron/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/preload",
      lib: {
        entry: resolve(__dirname, "electron/preload.ts"),
        formats: ["cjs"],
        fileName: () => "index.js",
      },
      rollupOptions: {
        output: {
          entryFileNames: "index.js",
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "gui"),
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(__dirname, "dist-electron/renderer"),
      rollupOptions: {
        input: resolve(__dirname, "gui/index.html"),
      },
    },
  },
});
