/** Losses within this window count toward the fallback. */
export const WEBGL_LOSS_WINDOW_MS = 60_000;
/** This many losses within the window move a terminal to the DOM renderer. */
export const WEBGL_MAX_LOSSES = 3;

/**
 * Records a WebGL context loss and decides whether the terminal reloads WebGL
 * or stays on xterm's DOM renderer. Chromium caps active WebGL contexts per
 * renderer (~16) and drops the oldest past that, so a reload can push another
 * terminal over the cap. Falling back after repeated losses keeps a loss from
 * ever looping.
 */
export function recordContextLoss(
  losses: readonly number[],
  now: number,
): { losses: number[]; fallback: boolean } {
  const recent = [...losses.filter((t) => now - t < WEBGL_LOSS_WINDOW_MS), now];
  return { losses: recent, fallback: recent.length >= WEBGL_MAX_LOSSES };
}

/** The parts of xterm's WebglAddon the lifecycle uses. */
export interface WebglAddonLike {
  dispose(): void;
  onContextLoss(cb: () => void): unknown;
}

/** The parts of a WebGL context needed to free it. */
export interface LosableContext {
  getExtension(name: 'WEBGL_lose_context'): { loseContext(): void } | null;
}

/**
 * Owns a terminal's WebGL addon so that only an attached terminal holds a
 * context. Chromium caps active contexts per renderer (~16) and force-loses
 * the oldest past that, so keeping one per viewed session made losses rotate
 * through the terminals (#206). attach() loads the addon, detach() releases
 * it, a loss while detached waits for the next attach(), and repeated losses
 * leave the terminal on xterm's DOM renderer for good.
 */
export class WebglLifecycle<A extends WebglAddonLike = WebglAddonLike> {
  private addon: A | null = null;
  private attached = false;
  private losses: number[] = [];
  private fallback = false;

  constructor(
    private readonly deps: {
      /** Build a new addon (imports @xterm/addon-webgl). */
      create: () => Promise<A>;
      /** Load the addon into the terminal. */
      install: (addon: A) => void;
      /** The addon's live WebGL context, read just before it is disposed. */
      findContext: () => LosableContext | null;
      now?: () => number;
    },
  ) {}

  get loaded(): boolean {
    return this.addon !== null;
  }

  get fellBack(): boolean {
    return this.fallback;
  }

  async attach(): Promise<void> {
    this.attached = true;
    await this.load();
  }

  detach(): void {
    this.attached = false;
    this.release();
  }

  private async load(): Promise<void> {
    if (this.addon || this.fallback) return;
    try {
      const addon = await this.deps.create();
      // Detached, or another load won while the import resolved.
      // Not installed yet, so nothing to free: drop it.
      if (!this.attached || this.addon || this.fallback) return;
      addon.onContextLoss(() => this.onContextLoss(addon));
      this.deps.install(addon);
      this.addon = addon;
    } catch (err) {
      // A GPU-renderer failure drops to xterm's DOM renderer; log it so that
      // regression is visible, not mysterious.
      console.warn('[terminal] WebGL renderer failed, using DOM renderer:', err);
    }
  }

  /** Drop the addon; xterm swaps in its DOM renderer and repaints. */
  private release(): void {
    const addon = this.addon;
    if (!addon) return;
    this.addon = null;
    let gl: LosableContext | null = null;
    try {
      gl = this.deps.findContext();
    } catch {
      // No context to free; dispose still detaches the canvas.
    }
    try {
      addon.dispose();
    } catch (err) {
      console.warn('[terminal] WebGL addon dispose failed:', err);
    }
    // dispose() only drops the canvas, which keeps its context counted toward
    // Chromium's cap until GC. Lose it explicitly, after dispose so the
    // addon's own context-lost listener is gone and this isn't seen as a loss.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private onContextLoss(addon: A): void {
    if (addon !== this.addon) return; // a released addon's late loss
    this.release();
    const { losses, fallback } = recordContextLoss(this.losses, (this.deps.now ?? Date.now)());
    this.losses = losses;
    if (fallback) {
      this.fallback = true;
      console.warn('[terminal] WebGL context lost repeatedly, staying on DOM renderer');
      return;
    }
    if (this.attached) void this.load();
  }
}
