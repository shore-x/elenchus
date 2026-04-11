#!/usr/bin/env node
// Elenchus - CLI Entry Point
// Compatibility entrypoint: preserve the historical src/cli.ts path while
// delegating actual CLI behavior to the interfaces layer.

import { main } from "./interfaces/cli/main.js";

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
