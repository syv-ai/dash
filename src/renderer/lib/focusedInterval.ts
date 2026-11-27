/** What `focusedInterval` reads of the window: the browser's, or a test's. */
export interface FocusEnv {
  /** Whether the window is in front and visible. */
  isActive: () => boolean;
  /** Subscribe to the window gaining or losing focus or visibility; returns unsubscribe. */
  onChange: (listener: () => void) => () => void;
}

export const windowFocusEnv: FocusEnv = {
  isActive: () => !document.hidden && document.hasFocus(),
  onChange: (listener) => {
    window.addEventListener('focus', listener);
    window.addEventListener('blur', listener);
    document.addEventListener('visibilitychange', listener);
    return () => {
      window.removeEventListener('focus', listener);
      window.removeEventListener('blur', listener);
      document.removeEventListener('visibilitychange', listener);
    };
  },
};

/**
 * Run `tick` every `ms` while the window is focused and visible. It pauses
 * while Dash is in the background, and runs once at once when it comes back,
 * so what it keeps fresh is fresh again the moment the person looks.
 * Returns stop.
 */
export function focusedInterval(
  tick: () => void,
  ms: number,
  env: FocusEnv = windowFocusEnv,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const pause = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const sync = () => {
    if (!env.isActive()) return pause();
    if (timer !== null) return;
    tick();
    timer = setInterval(tick, ms);
  };
  if (env.isActive()) timer = setInterval(tick, ms);
  const off = env.onChange(sync);
  return () => {
    off();
    pause();
  };
}
