"use client";

import { useSyncExternalStore } from "react";

/** Below this width the grid is not usable (docs/UX.md §2): screens show cards instead. */
export const GRID_MIN_WIDTH = 900;

const QUERY = `(max-width: ${GRID_MIN_WIDTH - 0.02}px)`;

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * true under 900 px, false from 900 px, null before hydration (unknown on the server).
 * While it is null, render both the grid and the cards and let CSS pick
 * (`grid:hidden` / `hidden grid:block`) so nothing flashes; once known, mount only one.
 */
export function useNarrowViewport(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => null,
  );
}
