---
description: Stop the local Framewoven dev server (defaults to :3000, accepts a port arg).
argument-hint: [port]
allowed-tools: Bash(lsof *), Bash(kill *), Bash(echo *)
---

Port to stop: $ARGUMENTS (defaults to 3000 if empty).

Run:

```bash
# The harness substitutes a bare $ARGUMENTS, but not ${ARGUMENTS:-3000} - that
# form reads an unset shell variable and silently always targets 3000.
PORT="$ARGUMENTS"
PORT="${PORT:-3000}"

# Scope to listening sockets only. A bare `lsof -ti :$PORT` also matches any
# process merely holding a client connection to that port, so an unscoped kill
# can take down unrelated work that happens to be talking to this port.
PIDS=$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill 2>/dev/null && echo "Stopped server on :$PORT (PIDs: $PIDS)."
else
  echo "Nothing was listening on :$PORT."
fi
```
