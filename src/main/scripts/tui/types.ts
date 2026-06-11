/**
 * Context handed to feature screen handlers. `clack` is provided by the
 * runtime (which lazy-requires it AFTER the isTTY hack) — feature modules
 * must never value-import @clack/prompts themselves.
 */
export interface ScreenContext {
  send(msg: unknown): void;
  clack: typeof import('@clack/prompts');
  startSpinner(label: string): void;
  stopSpinner(): void;
  env: NodeJS.ProcessEnv;
}

export type ShowHandler = (
  msg: { type: 'show'; screen: string; props?: unknown },
  ctx: ScreenContext,
) => Promise<void>;
