import { describe, it, expect } from "vitest";
import {
  ACTIVE_POLL_MS,
  IDLE_POLL_MS,
  watchGenerationStatus,
  type GenerationStatus,
} from "@/components/editor/useGenerationStatus";

// The editor tab's view of the server, driven by hand: `server` is what the
// status endpoint answers, and scheduled checks run only when `tick()` says so.
function harness() {
  const server: { status: GenerationStatus; fail: boolean } = {
    status: { generating: false, interrupted: null },
    fail: false,
  };
  const seen: GenerationStatus[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  let visible = true;
  let requests = 0;

  const watcher = watchGenerationStatus({
    onStatus: (status) => seen.push(status),
    fetchStatus: async () => {
      requests++;
      if (server.fail) throw new Error("offline");
      return server.status;
    },
    isVisible: () => visible,
    schedule: (run, ms) => {
      const timer = { run, ms };
      timers.push(timer);
      return timer;
    },
    unschedule: (handle) => {
      const i = timers.indexOf(handle as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    server,
    seen,
    watcher,
    settle,
    get requests() {
      return requests;
    },
    setVisible: (v: boolean) => {
      visible = v;
    },
    /** The delay of the next scheduled check, or null if none is scheduled. */
    nextDelay: () => (timers.length ? timers[0].ms : null),
    async tick() {
      const timer = timers.shift();
      if (!timer) throw new Error("No check is scheduled");
      timer.run();
      await settle();
    },
  };
}

describe("an editor tab watching generation status", () => {
  it("notices a generation started from another tab while it sits idle", async () => {
    const tab = harness();
    await tab.settle();
    expect(tab.seen.at(-1)).toEqual({ generating: false, interrupted: null });
    // Idle, it keeps asking. The previous editor stopped asking here, so a
    // tab left open never learned that another tab had started generating.
    expect(tab.nextDelay()).toBe(IDLE_POLL_MS);

    tab.server.status = { generating: true, interrupted: null };
    await tab.tick();
    expect(tab.seen.at(-1)).toEqual({ generating: true, interrupted: null });
    expect(tab.nextDelay()).toBe(ACTIVE_POLL_MS);

    // The other tab's run is stopped after writing slides.
    const interrupted = { reason: "stopped" as const, endedAt: "2026-10-29T17:00:00.000Z" };
    tab.server.status = { generating: false, interrupted };
    await tab.tick();
    expect(tab.seen.at(-1)).toEqual({ generating: false, interrupted });
    expect(tab.nextDelay()).toBe(IDLE_POLL_MS);
    tab.watcher.stop();
  });

  it("stops asking while hidden and asks at once when shown again", async () => {
    const tab = harness();
    await tab.settle();
    tab.setVisible(false);
    await tab.tick();
    expect(tab.nextDelay()).toBeNull();

    tab.server.status = { generating: true, interrupted: null };
    tab.setVisible(true);
    tab.watcher.refresh();
    await tab.settle();
    expect(tab.seen.at(-1)?.generating).toBe(true);
    tab.watcher.stop();
  });

  it("keeps its last answer through a failed request and tries again", async () => {
    const tab = harness();
    await tab.settle();
    tab.server.status = { generating: true, interrupted: null };
    await tab.tick();
    tab.server.fail = true;
    await tab.tick();
    expect(tab.seen).toHaveLength(2);
    expect(tab.seen.at(-1)?.generating).toBe(true);
    expect(tab.nextDelay()).toBe(ACTIVE_POLL_MS);
    tab.watcher.stop();
  });

  it("does not overlap requests, and asks again after one in flight", async () => {
    const tab = harness();
    tab.watcher.refresh();
    tab.watcher.refresh();
    await tab.settle();
    await tab.settle();
    expect(tab.requests).toBe(2);
    expect(tab.nextDelay()).toBe(IDLE_POLL_MS);
    tab.watcher.stop();
  });

  it("asks nothing more once stopped", async () => {
    const tab = harness();
    await tab.settle();
    tab.watcher.stop();
    expect(tab.nextDelay()).toBeNull();
    const before = tab.requests;
    tab.watcher.refresh();
    await tab.settle();
    expect(tab.requests).toBe(before);
  });
});
