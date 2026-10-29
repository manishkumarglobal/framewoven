import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { checkApiRequest, isLoopbackHost } from "@/lib/request-guard";
import { proxy, config } from "@/proxy";

function apiRequest(
  method: string,
  headers: Record<string, string>,
  url = "http://localhost:3000/api/carousels"
): NextRequest {
  return new NextRequest(url, { method, headers });
}

describe("isLoopbackHost", () => {
  it.each(["localhost", "localhost:3000", "127.0.0.1:3010", "[::1]:3000", "LOCALHOST:3000"])(
    "accepts %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    }
  );

  it.each([null, "", "192.168.1.4:3000", "evil.example:3000", "localhost.evil.example", "127.0.0.2:3000", "[::2]:3000"])(
    "rejects %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    }
  );
});

describe("checkApiRequest", () => {
  it("allows the design agent's curl write, which sends no Origin", () => {
    expect(checkApiRequest(apiRequest("POST", { host: "localhost:3000" }))).toBe("allow");
  });

  it("allows a write from the app's own page", () => {
    for (const [host, origin] of [
      ["localhost:3000", "http://localhost:3000"],
      ["127.0.0.1:3010", "http://127.0.0.1:3010"],
    ]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(checkApiRequest(apiRequest(method, { host, origin }))).toBe("allow");
      }
    }
  });

  it("refuses a write carrying another site's Origin", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        checkApiRequest(apiRequest(method, { host: "localhost:3000", origin: "https://evil.example" }))
      ).toBe("cross-site-origin");
    }
  });

  it("refuses a write from the same host on another port", () => {
    expect(
      checkApiRequest(apiRequest("POST", { host: "localhost:3000", origin: "http://localhost:4000" }))
    ).toBe("cross-site-origin");
  });

  it("refuses a write with Origin: null", () => {
    expect(
      checkApiRequest(apiRequest("POST", { host: "localhost:3000", origin: "null" }))
    ).toBe("cross-site-origin");
  });

  it("allows a read with a foreign Origin, whose response the browser withholds", () => {
    expect(
      checkApiRequest(apiRequest("GET", { host: "localhost:3000", origin: "https://evil.example" }))
    ).toBe("allow");
  });

  it("refuses any request whose Host is not loopback, as a DNS-rebinding page would send", () => {
    for (const method of ["GET", "POST"]) {
      expect(
        checkApiRequest(
          apiRequest(method, { host: "evil.example:3000", origin: "http://evil.example:3000" })
        )
      ).toBe("non-loopback-host");
    }
  });
});

describe("proxy", () => {
  it("runs only for API routes", () => {
    expect(config.matcher).toBe("/api/:path*");
  });

  it("lets an allowed request through", () => {
    const response = proxy(apiRequest("POST", { host: "localhost:3000" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("answers a refused request with a generic 403", async () => {
    const response = proxy(
      apiRequest("POST", { host: "localhost:3000", origin: "https://evil.example" })
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Request refused" });
  });
});

describe("server startup", () => {
  const scripts = JSON.parse(
    readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8")
  ).scripts as Record<string, string>;

  // Every supported start path (/start, npm run setup, npm run dev, npm start)
  // runs one of these two scripts, and Next.js otherwise listens on 0.0.0.0.
  it.each(["dev", "start"])("binds `npm run %s` to loopback", (name) => {
    expect(scripts[name]).toMatch(/\s-H 127\.0\.0\.1(\s|$)/);
  });
});
