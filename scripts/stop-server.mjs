#!/usr/bin/env node
// Stop the Framewoven server this checkout is running, and nothing else.
//
// Pure Node, no dependencies.
//
// `/stop` used to kill whatever listened on port 3000. A server started with
// `/start 3010` was left running, while an unrelated app on 3000, or another
// worktree's Framewoven, was killed instead. A port number says nothing about
// who owns the process behind it, so this script decides from the process
// itself. A listening process counts as this checkout's server only when all
// of these hold:
//
//   - it belongs to the current user,
//   - its command line is a Next.js server (`next dev`, `next start`, or the
//     `next-server` worker that actually holds the socket), and
//   - its working directory is this checkout's root. `npm run dev`, `npm start`
//     and scripts/dev-server.mjs all run Next.js from there, and every worktree
//     has its own root, so this is what tells instances apart.
//
// Without a port, the script stops the one server that matches; with several
// it lists them and stops none. With a port, it stops that port's server only
// if it matches, and otherwise says what is there and leaves it running.
// Nothing is recorded at start, so there is no state to go stale.
//
// Usage: node scripts/stop-server.mjs [port]
// Exit status: 0 stopped or nothing to stop, 1 refused or ambiguous, 2 usage.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The program itself, never its arguments: the `next-server (vX)` process that
 * holds the socket, or `node …/next dev|start`. Anchored at the start because
 * an argument can contain anything; the design agent runs as `claude -p
 * "<the user's message>"` from this checkout, and a message such as "move the
 * CTA to the next slide" must not make it look like a server.
 */
const NEXT_SERVER_COMMAND =
  /^(next-server(\s|$)|\S*\bnode(\.exe)?\s+\S*[\\/]next\s+(dev|start)(\s|$))/;

const STOP_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Reading the system. Each probe answers two questions: which processes listen
// on which TCP ports, and who/what/where a process is.

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err) {
    // lsof exits 1 when it finds nothing, still printing what it found.
    return typeof err?.stdout === "string" ? err.stdout : "";
  }
}

/** Reads `lsof -nP -iTCP -sTCP:LISTEN -Fpn` output as {pid, port} pairs. */
export function parseLsofListeners(output) {
  const found = new Map();
  let pid = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    } else if (line.startsWith("n") && pid !== null) {
      const port = Number(line.slice(line.lastIndexOf(":") + 1));
      if (Number.isInteger(port) && port > 0) found.set(`${pid}:${port}`, { pid, port });
    }
  }
  return [...found.values()];
}

/** Reads `ps -o uid= -o command= -p <pid>` output. */
export function parsePsLine(output) {
  const match = output.trim().match(/^(\d+)\s+(.*)$/);
  return match ? { uid: Number(match[1]), command: match[2].trim() } : null;
}

/** Reads `lsof -a -p <pid> -d cwd -Fn` output: the `n` line is the directory. */
export function parseLsofCwd(output) {
  const line = output.split("\n").find((l) => l.startsWith("n"));
  return line ? line.slice(1) : null;
}

/**
 * Reads /proc/net/tcp or /proc/net/tcp6 as a map from socket inode to port,
 * for sockets in the LISTEN state (st 0A).
 */
export function parseProcNetTcp(text) {
  const byInode = new Map();
  for (const line of text.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 10 || cols[3] !== "0A") continue;
    const port = parseInt(cols[1].split(":").pop(), 16);
    if (port > 0) byInode.set(cols[9], port);
  }
  return byInode;
}

function realDir(dir) {
  try {
    // The native call also returns the on-disk letter case, which matters on
    // macOS, where /Users/me/Framewoven and /Users/me/framewoven are one folder.
    return fs.realpathSync.native(dir);
  } catch {
    return null;
  }
}

/**
 * macOS and other systems with lsof. lsof only reports sockets of processes it
 * may inspect, which for an ordinary user means their own.
 */
export const lsofProbe = {
  listListeners() {
    return parseLsofListeners(run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]));
  },
  processInfo(pid) {
    const ps = parsePsLine(run("ps", ["-ww", "-o", "uid=", "-o", "command=", "-p", String(pid)]));
    if (!ps) return null;
    const cwd = parseLsofCwd(run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]));
    return { ...ps, cwd: cwd && realDir(cwd) };
  },
};

/**
 * Linux, from /proc. Some sandboxes ship an lsof that cannot map sockets to
 * processes; /proc always can, for every process the user may inspect.
 */
export const procProbe = {
  listListeners() {
    const ports = new Map();
    for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      try {
        for (const [inode, port] of parseProcNetTcp(fs.readFileSync(table, "utf-8"))) {
          ports.set(inode, port);
        }
      } catch {
        // No IPv6 table, for example.
      }
    }
    const found = new Map();
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      let fds;
      try {
        fds = fs.readdirSync(`/proc/${entry}/fd`);
      } catch {
        continue; // Gone, or not ours to inspect.
      }
      for (const fd of fds) {
        let target;
        try {
          target = fs.readlinkSync(`/proc/${entry}/fd/${fd}`);
        } catch {
          continue;
        }
        const inode = target.match(/^socket:\[(\d+)\]$/)?.[1];
        const port = inode && ports.get(inode);
        if (port) found.set(`${entry}:${port}`, { pid: Number(entry), port });
      }
    }
    return [...found.values()];
  },
  processInfo(pid) {
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, "utf-8");
      const uid = Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);
      const command = fs
        .readFileSync(`/proc/${pid}/cmdline`, "utf-8")
        .split("\0")
        .join(" ")
        .trim();
      return { uid, command, cwd: realDir(`/proc/${pid}/cwd`) };
    } catch {
      return null;
    }
  },
};

// ---------------------------------------------------------------------------
// Deciding. Pure functions of what the probe saw, so every case is testable.

/**
 * "ours": this checkout's Framewoven server. "other-checkout": a Next.js
 * server of the same user running from another directory, such as another
 * worktree. "unrelated": anything else, including another user's process.
 * "gone": exited since it was listed.
 */
export function classify(info, { root, uid }) {
  if (!info) return "gone";
  if (info.uid !== uid || !NEXT_SERVER_COMMAND.test(info.command)) return "unrelated";
  return info.cwd === root ? "ours" : "other-checkout";
}

function describe({ pid, port, info, kind }) {
  const what = info ? info.command.replace(/\s+/g, " ").slice(0, 80) : "exited";
  const where =
    kind === "other-checkout" ? `, Framewoven/Next.js from ${info.cwd}` : "";
  return `  :${port}  PID ${pid}  ${what}${where}`;
}

/**
 * Decides what to stop. `listeners` are {pid, port, info} as the probe saw
 * them. Returns {action: "stop", pids, ports, message} or {action: "none" |
 * "refuse" | "ambiguous", message}; only "stop" lets anything be signalled.
 */
export function planStop({ root, uid, port, listeners }) {
  const seen = listeners.map((l) => ({ ...l, kind: classify(l.info, { root, uid }) }));

  if (port !== undefined) {
    const onPort = seen.filter((l) => l.port === port && l.kind !== "gone");
    if (onPort.length === 0) {
      return { action: "none", message: `No process of yours is listening on :${port}.` };
    }
    const ours = onPort.filter((l) => l.kind === "ours");
    const others = onPort.filter((l) => l.kind !== "ours");
    if (ours.length === 0) {
      const hint = others.some((l) => l.kind === "other-checkout")
        ? "\nTo stop another checkout's server, run /stop from that checkout."
        : "";
      return {
        action: "refuse",
        message:
          `Port ${port} is not served by this checkout's Framewoven server (${root}), ` +
          `so nothing was stopped:\n${others.map(describe).join("\n")}${hint}`,
      };
    }
    const leftRunning = others.length
      ? `\nLeft running on the same port:\n${others.map(describe).join("\n")}`
      : "";
    return {
      action: "stop",
      pids: [...new Set(ours.map((l) => l.pid))],
      ports: [port],
      message: leftRunning,
    };
  }

  const ours = seen.filter((l) => l.kind === "ours");
  const pids = [...new Set(ours.map((l) => l.pid))];
  const otherCheckouts = seen.filter((l) => l.kind === "other-checkout");
  const elsewhere = otherCheckouts.length
    ? `\nServers from other checkouts were left running:\n${otherCheckouts.map(describe).join("\n")}`
    : "";

  if (pids.length === 0) {
    return {
      action: "none",
      message: `No Framewoven server from this checkout (${root}) is running.${elsewhere}`,
    };
  }
  if (pids.length > 1) {
    return {
      action: "ambiguous",
      message:
        `Found ${pids.length} Framewoven servers from this checkout (${root}), so nothing was stopped:\n` +
        `${ours.map(describe).join("\n")}\n` +
        "Run /stop <port> to choose which one to stop.",
    };
  }
  return {
    action: "stop",
    pids,
    ports: [...new Set(ours.map((l) => l.port))].sort((a, b) => a - b),
    message: elsewhere,
  };
}

// ---------------------------------------------------------------------------
// Acting.

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/** Reads a port argument; "" or undefined means none. Returns NaN if invalid. */
export function parsePortArg(arg) {
  if (arg === undefined || arg.trim() === "") return undefined;
  const text = arg.trim();
  const port = /^\d+$/.test(text) ? Number(text) : NaN;
  return port >= 1 && port <= 65535 ? port : NaN;
}

export async function main({
  args = process.argv.slice(2),
  root = ROOT,
  uid = process.getuid?.(),
  probe = process.platform === "linux" ? procProbe : lsofProbe,
  signal = (pid) => {
    process.kill(pid, "SIGTERM");
  },
  alive = isAlive,
  timeoutMs = STOP_TIMEOUT_MS,
  log = (line) => console.log(line),
} = {}) {
  if (process.platform === "win32" || uid === undefined) {
    log("/stop is not supported on Windows. Stop the server with Ctrl+C in its terminal.");
    return 1;
  }

  const port = parsePortArg(args[0]);
  if (Number.isNaN(port)) {
    log(`"${args[0]}" is not a port number. Usage: /stop [port]`);
    return 2;
  }

  const realRoot = realDir(root) ?? root;
  const listeners = probe
    .listListeners()
    .filter((l) => port === undefined || l.port === port)
    .map((l) => ({ ...l, info: probe.processInfo(l.pid) }));

  const plan = planStop({ root: realRoot, uid, port, listeners });
  if (plan.action !== "stop") {
    log(plan.message);
    return plan.action === "none" ? 0 : 1;
  }

  // Check each process again right before signalling it, so a PID that has
  // exited, or been reused by something else since it was listed, is never hit.
  const signalled = [];
  let exitedMeanwhile = 0;
  for (const pid of plan.pids) {
    const now = classify(probe.processInfo(pid), { root: realRoot, uid });
    if (now === "gone") {
      log(`The server with PID ${pid} has already exited.`);
      exitedMeanwhile++;
      continue;
    }
    if (now !== "ours") {
      log(`PID ${pid} is no longer this checkout's server; left alone.`);
      continue;
    }
    try {
      signal(pid);
      signalled.push(pid);
    } catch (err) {
      log(`Could not stop PID ${pid}: ${err?.message ?? err}`);
    }
  }
  if (signalled.length === 0) return exitedMeanwhile === plan.pids.length ? 0 : 1;

  const deadline = Date.now() + timeoutMs;
  while (signalled.some(alive) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const ports = plan.ports.map((p) => `:${p}`).join(", ");
  const still = signalled.filter(alive);
  if (still.length > 0) {
    log(
      `Asked the server on ${ports} to stop (PID ${signalled.join(", ")}), ` +
        `but PID ${still.join(", ")} is still running after ${timeoutMs / 1000}s.`
    );
    return 1;
  }
  log(`Stopped the Framewoven server on ${ports} (PID ${signalled.join(", ")}).${plan.message}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(realDir(process.argv[1]) ?? "").href;
if (invokedDirectly) {
  process.exitCode = await main();
}
