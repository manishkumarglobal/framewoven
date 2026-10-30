import { mutateData, readDataSafe } from "./data";
import { getCarousel } from "./carousels";

/**
 * Whether a carousel is being generated, and whether its last generation was
 * interrupted.
 *
 * `/api/chat` begins a run for its carousel when the Claude CLI subprocess
 * starts and finishes it when that subprocess exits. The subprocess is what
 * adds and edits slides, so its exit is the point after which the carousel
 * stops changing.
 *
 * While a run is live the carousel is "generating", which is held in process
 * memory: a server restart kills every subprocess, so nothing can be left
 * generating. Memory lives on `globalThis` because Next.js may bundle this
 * module separately for each route, and the chat and export routes must agree.
 *
 * How the run ended is persisted in `data/generation-runs.json`, so it
 * survives a reload and a server restart:
 *
 * - A run that exits successfully, or that changed no slides, leaves the
 *   carousel as it was before the run.
 * - A run that changed slides and then was stopped (the Stop button, a reload,
 *   a closed tab), failed or timed out marks the carousel "interrupted": its
 *   slides are kept, but export refuses it until the user either confirms the
 *   slides as they are or a later run completes.
 * - A run still recorded as running when no subprocess is live means the
 *   server stopped mid-run; that reads as interrupted too.
 */

export type InterruptionReason = "stopped" | "failed" | "timed-out" | "server-stopped";

export interface Interruption {
  reason: InterruptionReason;
  endedAt: string;
}

/** How a run ended. "not-started" means the CLI never ran. */
export type RunOutcome = "completed" | "not-started" | InterruptionReason;

type RunRecord =
  | {
      state: "running";
      startedAt: string;
      /** The carousel's `updatedAt` when the run began, to tell whether it wrote anything. */
      baseline: string | null;
      /** An interruption recorded before this run, restored if this run changes nothing. */
      previous: Interruption | null;
    }
  | ({ state: "interrupted" } & Interruption);

interface RunsFile {
  runs: Record<string, RunRecord>;
}

const RUNS_FILE = "generation-runs.json";
const emptyRuns = (): RunsFile => ({ runs: {} });

/** In memory: live runs per carousel, and the write that settles the last one. */
interface LiveRuns {
  count: number;
  outcome: RunOutcome | null;
  started: Promise<void>;
}

// Keeps the product's former name: a running server that reloads this module
// must find the same registry, or it would lose generations in progress.
const REGISTRY_KEY = Symbol.for("framewoven.generation-status");

function registry(): Map<string, LiveRuns> {
  const store = globalThis as typeof globalThis & {
    [REGISTRY_KEY]?: Map<string, LiveRuns>;
  };
  store[REGISTRY_KEY] ??= new Map();
  return store[REGISTRY_KEY];
}

const INTERRUPTING: readonly RunOutcome[] = ["stopped", "failed", "timed-out", "server-stopped"];

/** The worse of two outcomes, so concurrent runs report any interruption. */
function worse(a: RunOutcome | null, b: RunOutcome): RunOutcome {
  if (a === null || a === "not-started") return b;
  if (b === "not-started") return a;
  return INTERRUPTING.includes(b) ? b : a;
}

/**
 * How a Claude CLI run ended, from what the chat route observed. A clean exit
 * whose final result reported an error (for example the budget ran out) did
 * not finish its work either.
 */
export function classifyRunExit(exit: {
  cancelled: boolean;
  timedOut: boolean;
  code: number | null;
  resultIsError: boolean;
}): RunOutcome {
  if (exit.timedOut) return "timed-out";
  if (exit.cancelled) return "stopped";
  if (exit.code !== 0 || exit.resultIsError) return "failed";
  return "completed";
}

function interruptionOf(record: RunRecord | undefined): Interruption | null {
  if (!record) return null;
  if (record.state === "interrupted") {
    return { reason: record.reason, endedAt: record.endedAt };
  }
  // Recorded as running, but no run is live: the server stopped mid-run.
  return { reason: "server-stopped", endedAt: record.startedAt };
}

/**
 * Marks a run as started for `carouselId` and returns the function that
 * finishes it with its outcome. The carousel counts as generating until that
 * function's returned promise resolves, by which time the outcome is saved.
 * Finishing twice has no effect. `baseline` is the carousel's `updatedAt` as
 * the run began.
 */
export function beginGeneration(
  carouselId: string,
  baseline: string | null
): (outcome: RunOutcome) => Promise<void> {
  const runs = registry();
  let live = runs.get(carouselId);
  if (!live) {
    live = { count: 0, outcome: null, started: Promise.resolve() };
    runs.set(carouselId, live);
  }
  if (live.count === 0) {
    live.outcome = null;
    live.started = mutateData(RUNS_FILE, emptyRuns, (data) => {
      // Nothing was live, so an existing "running" record is one the server
      // never finished; it is kept as the interruption it was.
      const previous = interruptionOf(data.runs[carouselId]);
      data.runs[carouselId] = {
        state: "running",
        startedAt: new Date().toISOString(),
        baseline,
        previous,
      };
    }).catch((err) => {
      console.error("[generation] could not record the start of a run", err);
    });
  }
  live.count++;
  const entry = live;

  let finished: Promise<void> | null = null;
  return (outcome) => {
    finished ??= (async () => {
      entry.outcome = worse(entry.outcome, outcome);
      if (entry.count > 1) {
        entry.count--;
        return;
      }
      await entry.started;
      await settle(carouselId, entry.outcome).catch((err) => {
        console.error("[generation] could not record how a run ended", err);
      });
      entry.count--;
      if (entry.count === 0) runs.delete(carouselId);
    })();
    return finished;
  };
}

/** Saves how the last live run for a carousel ended. */
async function settle(carouselId: string, outcome: RunOutcome): Promise<void> {
  const current = await getCarousel(carouselId).catch(() => null);
  await mutateData(RUNS_FILE, emptyRuns, (data) => {
    const record = data.runs[carouselId];
    const running = record?.state === "running" ? record : null;
    const changed = !running || (current?.updatedAt ?? null) !== running.baseline;
    const previous = running ? running.previous : interruptionOf(record);

    let next: Interruption | null;
    if (!changed || outcome === "not-started") next = previous;
    else if (outcome === "completed") next = null;
    else next = { reason: outcome, endedAt: new Date().toISOString() };

    if (next) data.runs[carouselId] = { state: "interrupted", ...next };
    else delete data.runs[carouselId];
  });
}

/** True while at least one design-agent run for this carousel has not ended. */
export function isGenerating(carouselId: string): boolean {
  return registry().has(carouselId);
}

/**
 * How the carousel's last generation was interrupted, or null if it was not.
 * A generating carousel reports null; its run has not ended yet.
 */
export async function getInterruption(carouselId: string): Promise<Interruption | null> {
  if (isGenerating(carouselId)) return null;
  const data = await readDataSafe<RunsFile>(RUNS_FILE, emptyRuns());
  return interruptionOf(data.runs[carouselId]);
}

/**
 * The user's confirmation that an interrupted carousel's slides are what they
 * want. Returns false, changing nothing, while a run is live.
 */
export async function acceptInterruptedSlides(carouselId: string): Promise<boolean> {
  if (isGenerating(carouselId)) return false;
  await mutateData(RUNS_FILE, emptyRuns, (data) => {
    delete data.runs[carouselId];
  });
  return true;
}

/** What the export route answers while a run is still writing slides. */
export const GENERATION_IN_PROGRESS_ERROR =
  "Slides are still being generated. Export will be available as soon as generation finishes.";

const INTERRUPTION_CAUSE: Record<InterruptionReason, string> = {
  stopped: "was stopped",
  failed: "failed",
  "timed-out": "timed out",
  "server-stopped": "was cut off when the server stopped",
};

/** What the export route answers for an interrupted carousel. */
export function interruptedExportError(reason: InterruptionReason): string {
  return (
    `The last generation ${INTERRUPTION_CAUSE[reason]} before it finished, so these slides may be incomplete. ` +
    "Ask the AI to continue, or confirm in the editor that you want to use the slides as they are."
  );
}
