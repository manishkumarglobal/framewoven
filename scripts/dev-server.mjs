#!/usr/bin/env node
// Launch the Next.js dev server as an independent background process.
//
// Pure Node, no dependencies.
//
// Why this exists instead of a shell one-liner:
//
//   1. `npm run dev > file &` fails outright under shells with `noclobber`
//      set, because `>` refuses to truncate an existing log. Opening the log
//      through the filesystem API sidesteps shell redirect semantics entirely.
//   2. A server started as a child of the calling shell shares that shell's
//      process group, so it is torn down when the caller exits. `detached`
//      plus `unref()` gives the server its own session (POSIX) or process
//      group (Windows), letting it outlive whatever started it.
//   3. `&`, `>` and `2>&1` are not portable to Windows shells.
//
// Usage: node scripts/dev-server.mjs [port] [logPath]
// Prints a single line of JSON: {"pid":…,"port":"…","log":"…"}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";

const port = process.argv[2] || process.env.PORT || "3000";

// Keep the POSIX path predictable and easy to tail; fall back to the platform
// temp directory on Windows, where /tmp does not exist.
const defaultLog = IS_WIN
  ? path.join(os.tmpdir(), "framewoven-dev.log")
  : "/tmp/framewoven-dev.log";
const logPath = process.argv[3] || defaultLog;

// Truncates if present, creates if not - no shell involved, so `noclobber`
// cannot interfere.
const logFd = fs.openSync(logPath, "w");

const child = spawn("npm", ["run", "dev"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", logFd, logFd],
  detached: true,
  shell: IS_WIN,
});

child.on("error", (err) => {
  console.error(`Failed to start dev server: ${err?.message ?? err}`);
  process.exit(1);
});

// Release the parent's handle so this process can exit while the server runs.
child.unref();
fs.closeSync(logFd);

console.log(JSON.stringify({ pid: child.pid, port: String(port), log: logPath }));
