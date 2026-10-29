import { NextResponse, type NextRequest } from "next/server";
import { checkApiRequest } from "@/lib/request-guard";

/**
 * Refuses API requests that did not come from this machine's own app or from
 * the design agent. The API has no authentication, so this is what keeps other
 * sites in the owner's browser from driving it.
 */
export function proxy(request: NextRequest) {
  const decision = checkApiRequest(request);
  if (decision === "allow") return NextResponse.next();

  console.warn("[proxy] refused API request", {
    reason: decision,
    method: request.method,
    path: request.nextUrl.pathname,
  });
  return NextResponse.json({ error: "Request refused" }, { status: 403 });
}

export const config = {
  matcher: "/api/:path*",
};
