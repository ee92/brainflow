/**
 * Module-level store for diagram viewport state (pan position + zoom level).
 * Persists across React re-renders and route navigations within the same session.
 */

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

const viewportStore: Map<string, ViewportState> = new Map();

export function saveViewport(slug: string, state: ViewportState): void {
  viewportStore.set(slug, state);
}

export function getViewport(slug: string): ViewportState | undefined {
  return viewportStore.get(slug);
}

export function hasViewport(slug: string): boolean {
  return viewportStore.has(slug);
}
