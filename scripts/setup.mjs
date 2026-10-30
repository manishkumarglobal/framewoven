#!/usr/bin/env node
// Cross-platform setup for CreatorBrio. Runs on macOS, Linux, and Windows.
//
// Pure Node, no dependencies, safe to run pre-`npm install`.
// This file must never import a third-party package: it is the script that
// *installs* dependencies, so anything it imports would not yet exist on a
// fresh clone.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const IS_WIN = process.platform === "win32";

function log(msg) {
  process.stdout.write(msg + "\n");
}

// On Windows, npm/npx/puppeteer resolve to `.cmd` shims that cannot be spawned
// directly; running them through the shell is what makes this portable.
function runSync(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: IS_WIN, ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status}`);
  }
}

function tryProbeClaude() {
  const cmd = IS_WIN ? "where" : "which";
  try {
    const r = spawnSync(cmd, ["claude"], {
      encoding: "utf-8",
      timeout: 2000,
      shell: IS_WIN,
    });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/).find((l) => l.trim());
      if (first && fs.existsSync(first.trim())) return first.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

function findClaudePath() {
  if (
    process.env.CLAUDE_CLI_PATH &&
    fs.existsSync(process.env.CLAUDE_CLI_PATH)
  ) {
    return process.env.CLAUDE_CLI_PATH;
  }

  const home = os.homedir();
  const candidates = [];

  if (IS_WIN) {
    const appData =
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    const localAppData =
      process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    candidates.push(
      path.join(appData, "npm", "claude.cmd"),
      path.join(appData, "npm", "claude.exe"),
      path.join(localAppData, "Programs", "claude", "claude.exe")
    );
  } else {
    candidates.push(
      path.join(home, ".local/bin/claude"),
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      path.join(home, ".npm-global/bin/claude")
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return tryProbeClaude();
}

// Dependencies are installed with `--ignore-scripts` deliberately.
//
// npm may run a package's install script before that package's own optional
// platform binaries have been placed in the tree. When that happens to sharp,
// its check finds no prebuilt binary, falls back to compiling libvips from
// source, fails on machines without a native toolchain, and npm then rolls
// back the *entire* install. Newer npm releases also gate install scripts
// behind an approval allowlist, so their execution is not something a
// bootstrap script can rely on either way.
//
// Skipping install scripts makes the dependency tree deterministic across npm
// versions and machines. The one script-driven step this project actually
// needs - Puppeteer's Chromium download, used by PNG export - is then
// performed explicitly below.
function installDependencies() {
  log("📦 Installing dependencies...");
  runSync("npm", ["install", "--ignore-scripts"]);
  log("");
}

function installChromium() {
  log("🌐 Downloading Chromium for PNG export (~300MB on first run)...");
  const bin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    IS_WIN ? "puppeteer.cmd" : "puppeteer"
  );
  const hasBin = fs.existsSync(bin);
  const cmd = hasBin ? bin : "npx";
  const args = hasBin
    ? ["browsers", "install", "chrome"]
    : ["--no-install", "puppeteer", "browsers", "install", "chrome"];
  runSync(cmd, args);
  log("");
}

// Because install scripts are skipped, confirm the native modules that would
// normally verify themselves during install are actually usable.
async function verifyNativeModules() {
  log("🔬 Verifying native modules...");
  const require = createRequire(path.join(ROOT, "package.json"));
  let ok = true;

  try {
    const sharp = require("sharp");
    log(`  ✅ sharp ready (libvips ${sharp.versions.vips})`);
  } catch (err) {
    ok = false;
    log(`  ❌ sharp failed to load: ${err?.message ?? err}`);
    log("     Image processing will not work.");
  }

  // Checking that the executable file exists is not sufficient. An interrupted
  // download leaves the executable in place while the framework it links
  // against is missing, and Puppeteer's installer then treats that broken copy
  // as already installed and refuses to re-fetch it. Actually launching the
  // browser is the only check that proves PNG export will work.
  try {
    const puppeteer = require("puppeteer");
    const browser = await puppeteer.launch({ headless: true });
    await browser.close();
    log("  ✅ Chromium ready (launched successfully)");
  } catch (err) {
    ok = false;
    const firstLine = String(err?.message ?? err).split("\n")[0];
    log(`  ❌ Chromium failed to launch: ${firstLine}`);
    log("     PNG export will not work. The cached download is most likely incomplete.");
    let versionDir = null;
    try {
      const puppeteer = require("puppeteer");
      const m = puppeteer.executablePath().match(/^(.*[\\/]chrome[\\/][^\\/]+)[\\/]/);
      versionDir = m ? m[1] : null;
    } catch {
      // executablePath() is unavailable; fall back to generic advice below.
    }
    log("     Repair it by deleting the cached copy and re-downloading:");
    if (versionDir) log(`       rm -rf "${versionDir}"`);
    log("       npx puppeteer browsers install chrome");
  }

  log("");
  return ok;
}

function seedDataFiles() {
  const dataDir = path.join(ROOT, "data");
  const uploadsDir = path.join(ROOT, "public", "uploads");
  const exportsDir = path.join(dataDir, "exports");
  const fontCacheDir = path.join(dataDir, ".font-cache");

  for (const dir of [dataDir, uploadsDir, exportsDir, fontCacheDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const seeds = {
    "brand.json": {
      name: "",
      colors: {
        primary: "#1a1a2e",
        secondary: "#16213e",
        accent: "#e94560",
        background: "#ffffff",
        surface: "#f5f5f5",
      },
      fonts: { heading: "Inter", body: "Inter" },
      customFonts: [],
      logoPath: null,
      styleKeywords: [],
      createdAt: "",
      updatedAt: "",
    },
    "carousels.json": { carousels: [] },
    "templates.json": { templates: [] },
    "staged-actions.json": { actions: [] },
    "style-presets.json": { presets: [] },
  };

  for (const [name, contents] of Object.entries(seeds)) {
    const filePath = path.join(dataDir, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(contents), "utf-8");
      log(`  Created ${path.relative(ROOT, filePath)}`);
    }
  }
}

function writeEnvLocal(claudePath) {
  const envPath = path.join(ROOT, ".env.local");
  let existing = "";
  try {
    existing = fs.readFileSync(envPath, "utf-8");
  } catch {
    // file doesn't exist yet
  }

  const lines = existing
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("CLAUDE_CLI_PATH="));

  lines.push(`CLAUDE_CLI_PATH=${claudePath}`);

  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  fs.writeFileSync(envPath, lines.join("\n") + "\n", "utf-8");
}

async function main() {
  log("🎠 Setting up CreatorBrio...");
  log("");

  installDependencies();
  installChromium();
  const nativeOk = await verifyNativeModules();

  log("📁 Creating data directories...");
  seedDataFiles();
  log("");

  log("🔍 Looking for Claude CLI...");
  const claudePath = findClaudePath();
  if (claudePath) {
    log(`  ✅ Found Claude CLI at: ${claudePath}`);
    writeEnvLocal(claudePath);
  } else {
    log("  ⚠️  Claude CLI not found.");
    log("  The app will run without AI features.");
    log(
      "  To enable AI: install Claude CLI from https://docs.anthropic.com/en/docs/claude-code"
    );
    log("  Then set CLAUDE_CLI_PATH in .env.local");
    if (IS_WIN) {
      log("  On Windows, run `where claude` to find the path (likely ...\\npm\\claude.cmd).");
    }
  }
  log("");

  if (!nativeOk) {
    log("⚠️  Setup finished with warnings above. The app will start, but the");
    log("   features noted above may not work until they are resolved.");
    log("");
  }

  if (process.env.OC_SETUP_NO_DEV) {
    log("✅ Setup complete. (Dev server start skipped — caller will handle it.)");
    return;
  }

  log("🚀 Starting CreatorBrio...");
  log("  Open http://localhost:3000 in your browser");
  log("");
  runSync("npm", ["run", "dev"]);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
