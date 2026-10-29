import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  acceptInterruptedSlides,
  beginGeneration,
  classifyRunExit,
  getInterruption,
  isGenerating,
} from "@/lib/generation-status";
import { addSlide, createCarousel, getCarousel } from "@/lib/carousels";
import { exportFormatsFor } from "@/lib/export-formats";

// Real storage in a throwaway working directory: the run outcome is persisted
// in data/generation-runs.json next to the carousels it describes.
let workdir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  workdir = await mkdtemp(path.join(tmpdir(), "framewoven-generation-status-"));
  await mkdir(path.join(workdir, "data"), { recursive: true });
  await writeFile(
    path.join(workdir, "data", "brand.json"),
    JSON.stringify({
      name: "Synthetic",
      colors: { primary: "#111111", secondary: "#222222", accent: "#e94560", background: "#ffffff", surface: "#f4f4f4" },
      fonts: { heading: "Inter", body: "Inter" },
      customFonts: [],
      logoPath: null,
      styleKeywords: [],
      createdAt: "",
      updatedAt: "",
    })
  );
  process.chdir(workdir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(workdir, { recursive: true, force: true });
});

/** A carousel with one saved slide, and a run begun on it as the chat route does. */
async function startRun() {
  const carousel = await createCarousel("Run", "4:5");
  await addSlide(carousel.id, "<div>Hook</div>");
  const finish = beginGeneration(carousel.id, await updatedAt(carousel.id));
  return { id: carousel.id, finish };
}

async function updatedAt(id: string): Promise<string | null> {
  return (await getCarousel(id))?.updatedAt ?? null;
}

/** What the design agent does mid-run. Timestamps have millisecond resolution. */
async function agentWritesSlide(id: string) {
  await new Promise((resolve) => setTimeout(resolve, 5));
  await addSlide(id, "<div>Written by the agent</div>");
}

describe("how a run ended", () => {
  const exit = (over: Partial<Parameters<typeof classifyRunExit>[0]>) =>
    classifyRunExit({ cancelled: false, timedOut: false, code: 0, resultIsError: false, ...over });

  it("tells a completed run from a stopped, failed or timed-out one", () => {
    expect(exit({})).toBe("completed");
    expect(exit({ cancelled: true })).toBe("stopped");
    expect(exit({ cancelled: true, code: null })).toBe("stopped");
    expect(exit({ code: 1 })).toBe("failed");
    expect(exit({ code: null })).toBe("failed");
    // The CLI exited cleanly but its result was an error, e.g. the budget ran out.
    expect(exit({ resultIsError: true })).toBe("failed");
    expect(exit({ timedOut: true, code: null })).toBe("timed-out");
  });
});

describe("generation status", () => {
  it("is generating from the start of a run until its outcome is saved", async () => {
    const { id, finish } = await startRun();
    expect(isGenerating(id)).toBe(true);
    expect(await getInterruption(id)).toBeNull();
    await finish("completed");
    expect(isGenerating(id)).toBe(false);
    expect(await getInterruption(id)).toBeNull();
  });

  it("marks a carousel interrupted when a run that changed slides was stopped", async () => {
    for (const reason of ["stopped", "failed", "timed-out"] as const) {
      const { id, finish } = await startRun();
      await agentWritesSlide(id);
      await finish(reason);
      expect(await getInterruption(id)).toMatchObject({ reason });
    }
  });

  it("leaves a carousel alone when an interrupted run changed nothing", async () => {
    const { id, finish } = await startRun();
    await finish("stopped");
    expect(await getInterruption(id)).toBeNull();
  });

  it("keeps an earlier interruption through a run that changes nothing, even a completed one", async () => {
    const first = await startRun();
    await agentWritesSlide(first.id);
    await first.finish("failed");

    for (const outcome of ["completed", "stopped", "not-started"] as const) {
      const again = beginGeneration(first.id, await updatedAt(first.id));
      expect(await getInterruption(first.id)).toBeNull(); // generating
      await again(outcome);
      expect(await getInterruption(first.id)).toMatchObject({ reason: "failed" });
    }
  });

  it("clears an interruption when a later run completes after changing slides", async () => {
    const { id, finish } = await startRun();
    await agentWritesSlide(id);
    await finish("stopped");

    const resume = beginGeneration(id, await updatedAt(id));
    await agentWritesSlide(id);
    await resume("completed");
    expect(await getInterruption(id)).toBeNull();
  });

  it("reports a run cut off by a server restart as interrupted", async () => {
    const { id } = await startRun();
    await agentWritesSlide(id);
    // A restart loses the in-memory registry and every subprocess; only the
    // persisted "running" record is left.
    const registry = (globalThis as Record<symbol, Map<string, unknown>>)[
      Symbol.for("framewoven.generation-status")
    ];
    await new Promise((resolve) => setTimeout(resolve, 20));
    registry.delete(id);

    expect(isGenerating(id)).toBe(false);
    expect(await getInterruption(id)).toMatchObject({ reason: "server-stopped" });
    const saved = JSON.parse(await readFile(path.join(workdir, "data", "generation-runs.json"), "utf8"));
    expect(saved.runs[id].state).toBe("running");
  });

  it("counts concurrent runs and reports any interruption among them", async () => {
    const { id, finish: first } = await startRun();
    const second = beginGeneration(id, null);
    await agentWritesSlide(id);
    await first("stopped");
    await first("completed"); // a second finish of the same run is ignored
    expect(isGenerating(id)).toBe(true);
    await second("completed");
    expect(isGenerating(id)).toBe(false);
    expect(await getInterruption(id)).toMatchObject({ reason: "stopped" });
  });

  it("lets the user accept an interrupted carousel's slides, but not mid-run", async () => {
    const { id, finish } = await startRun();
    await agentWritesSlide(id);
    expect(await acceptInterruptedSlides(id)).toBe(false);
    await finish("failed");
    expect(await getInterruption(id)).not.toBeNull();

    expect(await acceptInterruptedSlides(id)).toBe(true);
    expect(await getInterruption(id)).toBeNull();
  });

  it("is shared by every copy of the module, as separately bundled routes load it", async () => {
    const { id, finish } = await startRun();
    vi.resetModules();
    const fresh = await import("@/lib/generation-status");
    expect(fresh.isGenerating(id)).toBe(true);
    await finish("completed");
    expect(fresh.isGenerating(id)).toBe(false);
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
