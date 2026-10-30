---
description: Stop this checkout's Framewoven server, on whatever port it runs (accepts a port arg).
argument-hint: [port]
allowed-tools: Bash(node *)
---

Port to stop (optional): $ARGUMENTS

Run this from the project root, exactly as written, with the argument quoted:

```bash
node scripts/stop-server.mjs "$ARGUMENTS"
```

Report the script's output to the user as it is. It is already short.

The script decides what to stop. Without a port it finds the Framewoven server
running from this checkout, whatever its port. With a port it stops that port's
server only if it is this checkout's. A server qualifies only if it belongs to
the current user, is a Next.js server process, and runs from this checkout's
directory, so other applications and other worktrees' servers are never
touched.

When it refuses, do not stop anything yourself and do not fall back to `lsof`
and `kill`. A refusal means one of two things:

- the port belongs to something else, and the output names it;
- this checkout runs more than one server, and the output lists their ports.

In the second case, ask the user which port to stop and run `/stop <port>`.
