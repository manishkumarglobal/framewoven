import { describe, it, expect, vi } from "vitest";
import {
  beginGeneration,
  isGenerating,
} from "@/lib/generation-status";
import { exportFormatsFor } from "@/lib/export-formats";

describe("generation status", () => {
  it("is generating from the start of a run until it ends", () => {
    expect(isGenerating("a")).toBe(false);
    const end = beginGeneration("a");
    expect(isGenerating("a")).toBe(true);
    end();
    expect(isGenerating("a")).toBe(false);
  });

  it("ignores a second end of the same run", () => {
    const first = beginGeneration("b");
    const second = beginGeneration("b");
    first();
    first();
    // The second run is still writing.
    expect(isGenerating("b")).toBe(true);
    second();
    expect(isGenerating("b")).toBe(false);
  });

  it("keeps carousels independent", () => {
    const end = beginGeneration("c");
    expect(isGenerating("d")).toBe(false);
    end();
  });

  it("is shared by every copy of the module, as separately bundled routes load it", async () => {
    const end = beginGeneration("e");
    vi.resetModules();
    const fresh = await import("@/lib/generation-status");
    expect(fresh.isGenerating("e")).toBe(true);
    end();
    expect(fresh.isGenerating("e")).toBe(false);
  });
});

describe("export menu choices", () => {
  const formats = (count: number) => exportFormatsFor(count).map((o) => o.format);

  it("offers the single PNG only for a one-slide carousel", () => {
    expect(formats(1)).toEqual(["png", "pdf", "single-png"]);
    expect(formats(2)).toEqual(["png", "pdf"]);
    expect(formats(20)).toEqual(["png", "pdf"]);
    expect(formats(0)).toEqual(["png", "pdf"]);
  });
});
