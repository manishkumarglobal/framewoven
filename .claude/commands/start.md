---
description: Bootstrap CreatorBrio - run setup, launch dev server, open browser.
argument-hint: [port]
allowed-tools: Bash(node *), Bash(uname *), Bash(test *), Bash(lsof *), Bash(kill *), Bash(curl *), Bash(open *), Bash(xdg-open *), Bash(cmd.exe *), Bash(npm *), Bash(tail *), AskUserQuestion
---

You are bootstrapping CreatorBrio for the user. Be terse — short status updates only, no preamble.

## Snapshot (these run before you see this prompt)

- Node: !`node --version 2>/dev/null || echo MISSING`
- Platform: !`uname -s 2>/dev/null || echo Windows`
- Port 3000 in use: !`lsof -nP -tiTCP:3000 -sTCP:LISTEN 2>/dev/null && echo YES || echo NO`
- node_modules: !`test -d node_modules && echo YES || echo NO`
- Data seeded: !`test -f data/carousels.json && echo YES || echo NO`

User-supplied port (optional): $ARGUMENTS

## Steps

1. **Verify Node ≥ 20.** Parse the version above. If MISSING or major version < 20, tell the user to install Node 20+ from https://nodejs.org and stop.

2. **Pick port.** Use `$ARGUMENTS` if non-empty, else 3000. Call this `<port>`.

3. **Run setup if needed.** If `node_modules` is NO **or** `Data seeded` is NO:
   - Tell the user: "Running setup (first time installs ~300MB Chromium for export — takes 1–2 minutes)..."
   - Run `OC_SETUP_NO_DEV=1 npm run setup` with a 600s timeout. The env var tells the setup script to skip its own dev-server start (`/start` manages the server itself in step 5). On Windows PowerShell use `$env:OC_SETUP_NO_DEV=1; npm run setup`; on cmd.exe use `set OC_SETUP_NO_DEV=1 && npm run setup`.
   - On failure, surface the error and stop.

4. **Handle port collision.** If `<port>` is in use, first check whether it is already CreatorBrio (named CreatorBrio before #29, which an
   instance that has not reloaded since may still show):
   `curl -s http://localhost:<port> | grep -qE "CreatorBrio|CreatorBrio"`.
   - If it is, the server is already up. Skip to step 7 and report normally. Do not
     restart it and do not ask the user anything.
   - Otherwise ask via AskUserQuestion: "Port `<port>` is in use. Kill the existing process or pick a different port?" Options: Kill / Different port / Cancel.
     - Kill → `lsof -nP -tiTCP:<port> -sTCP:LISTEN | xargs kill` then proceed to step 5.
       Always scope the lookup to `-sTCP:LISTEN`. A bare `lsof -ti :<port>` also matches
       unrelated processes that merely hold a client connection to that port, and killing
       those can disrupt work outside this project.
     - Different port → ask for new number, set `<port>`, re-check, then step 5.
     - Cancel → stop.

5. **Launch dev server** (only if not already running on `<port>`):
   Run `node scripts/dev-server.mjs <port>` as an ordinary foreground Bash call.
   It returns immediately, having detached the server into its own process group,
   and prints one line of JSON: `{"pid":…,"port":"…","log":"…"}`. Use the `log`
   value as `<logfile>` in the steps below.

   Do not pass `run_in_background`, and do not append a shell redirect. The
   launcher owns the log file. A background Bash task is torn down when the
   session turn ends, and a `>` redirect fails outright under shells with
   `noclobber` set - the launcher exists precisely to avoid both.

   Note: Next.js allows only one dev server per project directory. If the launcher
   log says another dev server is already running, treat that as success and use
   the port it reports.

6. **Wait until ready.** Poll `curl -sf http://localhost:<port>` every 1s until 200 (60s cap). On timeout, run `tail -30 <logfile>`, share the output, and stop.

7. **Open browser** based on Platform:
   - Darwin → `open http://localhost:<port>`
   - Linux → `xdg-open http://localhost:<port> 2>/dev/null || true`
   - Windows / MINGW / CYGWIN → `cmd.exe /c start http://localhost:<port>`

8. **Report ready** in two lines (no more):
   > CreatorBrio is running at http://localhost:`<port>`.
   > Logs: `tail -f <logfile>` • Stop with `/stop`

Idempotency note: re-running `/start` on a healthy install is fast — the setup script skips already-installed deps and already-seeded data, and step 4 skips the launch entirely when CreatorBrio is already serving on `<port>`. The dev server outlives the session that started it, so a previously started server is normally still running.
