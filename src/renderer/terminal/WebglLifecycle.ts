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

/**
 * How many terminals may keep a WebGL context (the "Terminals kept ready"
 * setting). Chromium allows about 16 active contexts per renderer and
 * force-loses the oldest past that, so the range tops out at 14, leaving room
 * for the main pane plus the session attach modal. 8 covers the handful of
 * tasks people switch between.
 */
export const WEBGL_HELD_MIN = 2;
export const WEBGL_HELD_MAX = 14;
export const WEBGL_HELD_DEFAULT = 8;

/** Rounds and clamps a held-terminal limit into WEBGL_HELD_MIN..MAX. */
export function clampHeldLimit(n: number): number {
  if (!Number.isFinite(n)) return WEBGL_HELD_DEFAULT;
  return Math.min(WEBGL_HELD_MAX, Math.max(WEBGL_HELD_MIN, Math.round(n)));
}

/** What the pool needs to know about a terminal. */
export interface PoolMember {
  readonly loaded: boolean;
  readonly isAttached: boolean;
  release(): void;
}

/**
 * Which members to release so at most `cap` hold a context. `order` runs
 * least to most recently attached; attached members are never picked.
 */
export function pickEvictions<T extends PoolMember>(order: readonly T[], cap: number): T[] {
  let excess = order.filter((m) => m.loaded).length - cap;
  const out: T[] = [];
  for (const m of order) {
    if (excess <= 0) break;
    if (m.loaded && !m.isAttached) {
      out.push(m);
      excess--;
    }
  }
  return out;
}

/** Recency list shared by every terminal's WebglLifecycle. */
export class WebglPool {
  private order: PoolMember[] = [];

  constructor(private cap = WEBGL_HELD_DEFAULT) {}

  /** Change the limit; lowering it releases the extra off-screen holders now. */
  setCap(cap: number): void {
    this.cap = cap;
    this.enforce();
  }

  /** Make `member` the most recently attached. */
  touch(member: PoolMember): void {
    this.remove(member);
    this.order.push(member);
  }

  remove(member: PoolMember): void {
    this.order = this.order.filter((m) => m !== member);
  }

  /** Release the least recently attached holders past the cap. */
  enforce(): void {
    for (const m of pickEvictions(this.order, this.cap)) m.release();
  }
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

const sharedPool = new WebglPool();

/** Apply the "Terminals kept ready" setting to every terminal. */
export function setWebglHeldLimit(n: number): void {
  sharedPool.setCap(clampHeldLimit(n));
}

/**
 * Owns a terminal's WebGL addon. attach() makes the terminal the most recent
 * in the shared pool and loads the addon if it has none; the pool then
 * releases the least recently attached detached terminal past
 * the held limit (#206: one context per viewed session made Chromium's cap
 * force-lose contexts in a loop). Detach keeps the addon so switching back is
 * instant. A loss while detached waits for the next attach(), and repeated
 * losses leave the terminal on xterm's DOM renderer for good.
 */
export class WebglLifecycle<A extends WebglAddonLike = WebglAddonLike> implements PoolMember {
  private addon: A | null = null;
  private attached = false;
  private disposed = false;
  private losses: number[] = [];
  private fallback = false;
  private readonly pool: WebglPool;

  constructor(
    private readonly deps: {
      /** Build a new addon (imports @xterm/addon-webgl). */
      create: () => Promise<A>;
      /** Load the addon into the terminal. */
      install: (addon: A) => void;
      /** The addon's live WebGL context, read just before it is disposed. */
      findContext: () => LosableContext | null;
      now?: () => number;
      /** Defaults to the pool shared by every terminal. */
      pool?: WebglPool;
    },
  ) {
    this.pool = deps.pool ?? sharedPool;
  }

  get loaded(): boolean {
    return this.addon !== null;
  }

  get isAttached(): boolean {
    return this.attached;
  }

  get fellBack(): boolean {
    return this.fallback;
  }

  async attach(): Promise<void> {
    if (this.disposed) return;
    this.attached = true;
    this.pool.touch(this);
    // Also run here (not only on load): holders that were all attached at
    // once can leave the pool over the cap after they detach.
    this.pool.enforce();
    await this.load();
  }

  /** Keeps the addon; the pool releases it once enough others are attached. */
  detach(): void {
    this.attached = false;
  }

  dispose(): void {
    this.disposed = true;
    this.attached = false;
    this.pool.remove(this);
    this.release();
  }

  private async load(): Promise<void> {
    if (this.addon || this.fallback) return;
    try {
      const addon = await this.deps.create();
      // Detached, disposed, or another load won while the import resolved.
      // Not installed yet, so nothing to free: drop it.
      if (!this.attached || this.addon || this.fallback) return;
      addon.onContextLoss(() => this.onContextLoss(addon));
      this.deps.install(addon);
      this.addon = addon;
      this.pool.enforce();
    } catch (err) {
      // A GPU-renderer failure drops to xterm's DOM renderer; log it so that
      // regression is visible, not mysterious.
      console.warn('[terminal] WebGL renderer failed, using DOM renderer:', err);
    }
  }

  /** Drop the addon; xterm swaps in its DOM renderer and repaints. */
  release(): void {
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
    // A detached terminal reloads on its next attach().
    if (this.attached) void this.load();
  }
}
