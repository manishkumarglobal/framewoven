"use client";

import { useEffect, useState } from "react";

const POLL_MS = 1000;

/**
 * Whether the server still has a design-agent run writing to this carousel.
 *
 * While this tab's chat stream is open, the stream is the signal and this hook
 * stays quiet. It asks the server when the page opens, which covers a reload or
 * a second tab during generation, and again whenever this tab's stream closes,
 * because the subprocess can still be exiting for a moment after that. While
 * the answer is yes it keeps asking. If the question cannot be answered it
 * reports false and stops: the export route still refuses a carousel that is
 * being generated, so a lost status request cannot cause a partial export.
 */
export function useServerGeneration(
  carouselId: string,
  streaming: boolean
): boolean {
  const [generating, setGenerating] = useState(false);
  const [wasStreaming, setWasStreaming] = useState(streaming);

  // When this tab's stream closes, the subprocess may still be exiting. Count
  // it as generating until the server has answered, so export does not open
  // for the length of that request.
  if (streaming !== wasStreaming) {
    setWasStreaming(streaming);
    if (!streaming) setGenerating(true);
  }

  useEffect(() => {
    if (streaming) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      let active = false;
      try {
        const res = await fetch(`/api/carousels/${carouselId}/generation`, {
          cache: "no-store",
        });
        if (res.ok) {
          const body: { generating?: unknown } = await res.json();
          active = body.generating === true;
        }
      } catch {
        // Treated as not generating; see above.
      }
      if (cancelled) return;
      setGenerating(active);
      if (active) timer = setTimeout(check, POLL_MS);
    };

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [carouselId, streaming]);

  return generating;
}
