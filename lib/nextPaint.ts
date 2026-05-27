/**
 * Yield to the browser long enough for React to commit a pending render
 * AND for the compositor to paint at least one frame.
 *
 * Used right after `dispatch({ type: "SET_STATUS", status: "loading" })`
 * — before kicking off CPU-bound pipeline work (MediaPipe, image
 * decoding, canvas compositing) that would otherwise block the main
 * thread for 1–2 seconds and starve the loading-scene paint.
 *
 *  1. `requestAnimationFrame` waits for the next compositor tick (~16ms).
 *  2. The trailing `setTimeout(_, 0)` releases the macro-task queue so
 *     any micro-tasks scheduled during the rAF callback can settle.
 *
 * Two animation frames are typically enough on desktop. On mobile, a
 * single rAF + a macro-task yield gives the same guarantee with less
 * latency.
 */
export async function nextPaint(): Promise<void> {
  if (typeof window === "undefined") return;
  await new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    window.requestAnimationFrame(() => resolve());
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
