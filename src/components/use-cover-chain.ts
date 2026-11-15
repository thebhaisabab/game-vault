"use client";

import { useMemo, useState } from "react";
import { steamCoverFallbacks } from "@/lib/steam-art";

/**
 * Cycle a cover image through its fallback chain on error
 * (portrait cover -> header.jpg -> capsule_231x87.jpg for Steam art).
 * `exhausted` flips true once every candidate has failed.
 */
export function useCoverChain(src: string | null | undefined) {
  // Attempt state is keyed by the current src, so a changed src resets the
  // chain without an effect.
  const [state, setState] = useState<{
    src: string | null | undefined;
    attempt: number;
  }>({ src, attempt: 0 });
  const attempt = state.src === src ? state.attempt : 0;

  const chain = useMemo(
    () => (src ? [src, ...steamCoverFallbacks(src)] : []),
    [src],
  );
  const exhausted = chain.length === 0 || attempt >= chain.length;

  return {
    currentSrc: exhausted ? null : chain[attempt],
    exhausted,
    onError: () => setState({ src, attempt: attempt + 1 }),
  };
}
