/*
 * Dash's motion tokens for script: the same values `index.css` sets
 * (`--motion-quick`, `--motion-calm`, `--motion-slow`, `--ease-settle`,
 * `--ease-calm`), for Web Animations and timers, which can't take a `var()`.
 * `motion.test.ts` keeps the two in step.
 *
 * Motion is calm (U6): longer than you'd expect, small distances, eased out,
 * no bounce. `quick` is only for direct manipulation (hover, colour, press);
 * `calm` is most movement; `slow` is panels and large reveals.
 */

/** Durations (ms). */
export const MOTION_MS: Readonly<Record<'quick' | 'calm' | 'slow', number>> = {
  quick: 150,
  calm: 320,
  slow: 480,
};

/** Curves. `settle`: a gentle ease-out (cubic), for anything arriving or
 *  resizing; `calm`: an ease-in-out, for a move that travels (rows sliding,
 *  the task sidebar's planned motion) or leaves. */
export const EASE = {
  settle: 'cubic-bezier(0.33, 1, 0.68, 1)',
  calm: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/** Whether the user asked for reduced motion: every motion skips then. */
export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
