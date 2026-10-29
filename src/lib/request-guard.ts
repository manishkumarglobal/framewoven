import { resolveAppOrigin } from "./request-origin";

/**
 * Names a `Host` header may carry for a request to this machine. The server
 * listens on 127.0.0.1 only; `localhost` and `[::1]` are how browsers and curl
 * address it.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type GuardDecision = "allow" | "non-loopback-host" | "cross-site-origin";

/** Whether a `Host` header names this machine, with or without a port. */
export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  // `name[:port]`, where an IPv6 literal keeps its brackets.
  const match = host.toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/);
  return match !== null && LOOPBACK_HOSTNAMES.has(match[1]);
}

/**
 * Decides whether an API request may proceed.
 *
 * The `Host` check comes first because the origin check alone is not enough: a
 * page on a domain that re-resolves to 127.0.0.1 (DNS rebinding) makes requests
 * the browser considers same-origin, but their `Host` is that domain.
 *
 * A state-changing request is refused when it carries an `Origin` other than
 * this app's own. A request with no `Origin` is allowed: browsers always send
 * one on cross-site writes, and the design agent writes slides with curl, which
 * sends none.
 */
export function checkApiRequest(request: Request): GuardDecision {
  if (!isLoopbackHost(request.headers.get("host"))) return "non-loopback-host";

  if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) return "allow";

  const origin = request.headers.get("origin");
  if (origin === null) return "allow";
  return origin === resolveAppOrigin(request) ? "allow" : "cross-site-origin";
}
