/**
 * Which carousels a design-agent run is still writing to.
 *
 * `/api/chat` registers a run for its carousel when the Claude CLI subprocess
 * starts and releases it when that subprocess exits, whether it finished,
 * failed, timed out or was cancelled. The subprocess is what adds and edits
 * slides, so its exit is the point after which the carousel stops changing.
 * The export route refuses a carousel while a run is registered, and the editor
 * asks the same question after a reload or once its chat stream closes.
 *
 * State lives in process memory: a server restart kills every subprocess, so
 * nothing can be left marked as generating. It is held on `globalThis` because
 * Next.js may bundle this module separately for each route, and the chat and
 * export routes must see the same registry.
 */
const REGISTRY_KEY = Symbol.for("framewoven.generation-status");

type Registry = Map<string, number>;

function registry(): Registry {
  const store = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  store[REGISTRY_KEY] ??= new Map();
  return store[REGISTRY_KEY];
}

/**
 * Marks a run as started for `carouselId` and returns the function that marks
 * it finished. Calling that function again has no effect, so every exit path
 * can call it without counting a run twice. Runs are counted, so two chats on
 * the same carousel keep it generating until both have ended.
 */
export function beginGeneration(carouselId: string): () => void {
  const runs = registry();
  runs.set(carouselId, (runs.get(carouselId) ?? 0) + 1);

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const remaining = (runs.get(carouselId) ?? 1) - 1;
    if (remaining > 0) runs.set(carouselId, remaining);
    else runs.delete(carouselId);
  };
}

/** True while at least one design-agent run for this carousel has not ended. */
export function isGenerating(carouselId: string): boolean {
  return (registry().get(carouselId) ?? 0) > 0;
}

/** What the export route answers while a run is still writing slides. */
export const GENERATION_IN_PROGRESS_ERROR =
  "Slides are still being generated. Export will be available as soon as generation finishes.";
