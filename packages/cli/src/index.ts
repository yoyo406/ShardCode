#!/usr/bin/env node

export * from "./args.js";
export * from "./main.js";
export * from "./render.js";
export * from "./slash.js";
export * from "./theme.js";
export * from "./tui.js";

import { runCli } from "./main.js";
import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const exitCode = await runCli(process.argv.slice(2));
  if (exitCode !== 0) process.exitCode = exitCode;
}
