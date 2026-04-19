// Elenchus - Sidecar Build Script
// Bundles the sidecar TypeScript into a single JS file with esbuild,
// then compiles it into a standalone binary with pkg.
// The output binary is placed where Tauri's externalBin can find it.

import esbuild from "esbuild";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const SIDECAR_DIR = resolve(ROOT_DIR, "sidecar/dist");
const BIN_DIR = resolve(ROOT_DIR, "gui/src-tauri/binaries");

// Determine target triple
const arch = process.arch;
const platform = process.platform;
let TARGET;
if (platform === "darwin" && arch === "arm64") TARGET = "aarch64-apple-darwin";
else if (platform === "darwin" && arch === "x64") TARGET = "x86_64-apple-darwin";
else if (platform === "linux" && arch === "x64") TARGET = "x86_64-unknown-linux-gnu";
else if (platform === "linux" && arch === "arm64") TARGET = "aarch64-unknown-linux-gnu";
else if (platform === "win32") TARGET = "x86_64-pc-windows-msvc";
else { console.error(`Unsupported platform: ${platform}-${arch}`); process.exit(1); }

console.log(`→ Building sidecar for target: ${TARGET}`);

// Step 1: esbuild bundle
console.log("→ Bundling with esbuild...");

// Plugin: replace dynamic import() with require() for Node built-ins
// pkg's CJS environment does not support import(), but pi-ai uses it
// for node:fs, node:os, node:path to support browser builds.
const cjsDynamicImportPlugin = {
  name: "cjs-dynamic-import",
  setup(build) {
    build.onLoad({ filter: /env-api-keys\.js$/ }, async (args) => {
      let text = readFileSync(args.path, "utf8");
      // Replace: const dynamicImport = (specifier) => import(specifier);
      // With:    const dynamicImport = (specifier) => Promise.resolve(require(specifier));
      text = text.replace(
        /const\s+dynamicImport\s*=\s*\(\s*specifier\s*\)\s*=>\s*import\s*\(\s*specifier\s*\)/,
        "const dynamicImport = (specifier) => Promise.resolve(require(specifier))"
      );
      return { contents: text, loader: "js" };
    });
  },
};

await esbuild.build({
  entryPoints: [resolve(ROOT_DIR, "src/interfaces/web/main.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: resolve(SIDECAR_DIR, "main.js"),
  external: ["better-sqlite3"],
  plugins: [cjsDynamicImportPlugin],
  logLevel: "info",
});

// Step 2: pkg compile
console.log("→ Compiling with pkg...");

// Find better-sqlite3 native addon
let assetFlags = [];
const bsDir = resolve(ROOT_DIR, "node_modules/better-sqlite3");
try {
  const { readdirSync, statSync } = await import("node:fs");
  const findNodeFile = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findNodeFile(full);
        if (found) return found;
      } else if (entry.name === "better_sqlite3.node") {
        return full;
      }
    }
    return null;
  };
  if (statSync(bsDir).isDirectory()) {
    const nodeFile = findNodeFile(bsDir);
    if (nodeFile) {
      console.log(`→ Including native addon: ${nodeFile}`);
      assetFlags = ["--asset", nodeFile];
    } else {
      console.log("⚠ Warning: better_sqlite3.node not found, sidecar may fail at runtime");
    }
  }
} catch {}

const pkgTarget = platform === "darwin"
  ? (arch === "arm64" ? "node18-macos-arm64" : "node18-macos-x64")
  : platform === "linux"
    ? (arch === "arm64" ? "node18-linux-arm64" : "node18-linux-x64")
    : "node18-win-x64";

const outputPath = resolve(BIN_DIR, `elenchus-sidecar-${TARGET}`);
const pkgArgs = [
  "pkg",
  resolve(SIDECAR_DIR, "main.js"),
  "--target", pkgTarget,
  "--output", outputPath,
  ...assetFlags,
];

execSync(`npx ${pkgArgs.join(" ")}`, { stdio: "inherit", cwd: ROOT_DIR });

// Make executable (non-Windows)
if (platform !== "win32") {
  execSync(`chmod +x "${outputPath}"`, { stdio: "inherit" });
}

console.log(`✓ Sidecar binary: ${outputPath}`);
