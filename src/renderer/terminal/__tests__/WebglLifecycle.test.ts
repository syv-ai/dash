import { describe, it, expect, vi } from 'vitest';
import { recordContextLoss, WebglLifecycle, WEBGL_LOSS_WINDOW_MS } from '../WebglLifecycle';

describe('recordContextLoss', () => {
  it('reloads after a first and second loss', () => {
    const first = recordContextLoss([], 1_000);
    expect(first).toEqual({ losses: [1_000], fallback: false });
    const second = recordContextLoss(first.losses, 2_000);
    expect(second).toEqual({ losses: [1_000, 2_000], fallback: false });
  });

  it('falls back on the third loss within the window', () => {
    expect(recordContextLoss([1_000, 2_000], 3_000).fallback).toBe(true);
  });

  it('forgets losses older than the window', () => {
    const now = 1_000 + WEBGL_LOSS_WINDOW_MS;
    const result = recordContextLoss([1_000, 2_000], now);
    expect(result).toEqual({ losses: [2_000, now], fallback: false });
  });

  it('keeps reloading when losses are spread out', () => {
    let losses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const result = recordContextLoss(losses, i * WEBGL_LOSS_WINDOW_MS);
      expect(result.fallback).toBe(false);
      losses = result.losses;
    }
  });
});

class FakeAddon {
  disposed = false;
  lossCb: (() => void) | null = null;
  constructor(private readonly order: string[]) {}
  dispose() {
    this.order.push('dispose');
    this.disposed = true;
    this.lossCb = null; // like xterm, dispose drops the addon's listeners
  }
  onContextLoss(cb: () => void) {
    this.lossCb = cb;
  }
  /** Fire a loss; pass a saved callback to model a late event after dispose. */
  lose(cb = this.lossCb) {
    cb?.();
  }
}

/** `make()` builds a terminal's lifecycle with its own addon log. */
function setup() {
  let t = 0;
  const make = () => {
    const addons: FakeAddon[] = [];
    const order: string[] = [];
    const loseContext = vi.fn(() => order.push('loseContext'));
    const gpu = new WebglLifecycle<FakeAddon>({
      create: async () => {
        const a = new FakeAddon(order);
        addons.push(a);
        return a;
      },
      install: () => {},
      findContext: () => ({ getExtension: () => ({ loseContext }) }),
      now: () => t,
    });
    const last = () => {
      const a = addons[addons.length - 1];
      if (!a) throw new Error('no addon');
      return a;
    };
    return { gpu, addons, order, loseContext, last };
  };
  return { make, tick: (ms: number) => (t += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('WebglLifecycle', () => {
  it('loads on attach and once across repeated attaches', async () => {
    const { gpu, addons } = setup().make();
    await gpu.attach();
    await gpu.attach();
    expect(addons).toHaveLength(1);
    expect(gpu.loaded).toBe(true);
  });

  it('keeps the addon across detach and re-attach', async () => {
    const { gpu, addons } = setup().make();
    await gpu.attach();
    gpu.detach();
    expect(gpu.loaded).toBe(true);
    await gpu.attach();
    expect(addons).toHaveLength(1);
  });

  it('dispose frees the context and never loads again', async () => {
    const { gpu, order } = setup().make();
    await gpu.attach();
    gpu.dispose();
    expect(order).toEqual(['dispose', 'loseContext']);
    await gpu.attach();
    expect(gpu.loaded).toBe(false);
  });

  it('skips the load when disposed while the addon was being created', async () => {
    const { gpu } = setup().make();
    const pending = gpu.attach();
    gpu.dispose();
    await pending;
    expect(gpu.loaded).toBe(false);
  });

  it('reloads after a loss while attached', async () => {
    const { gpu, addons, last } = setup().make();
    await gpu.attach();
    last().lose();
    await flush();
    expect(addons).toHaveLength(2);
    expect(gpu.loaded).toBe(true);
  });

  it('defers the reload of a loss while detached to the next attach', async () => {
    const { gpu, addons, last } = setup().make();
    await gpu.attach();
    gpu.detach();
    last().lose();
    await flush();
    expect(gpu.loaded).toBe(false);
    expect(addons).toHaveLength(1);
    await gpu.attach();
    expect(addons).toHaveLength(2);
    expect(gpu.loaded).toBe(true);
  });

  it("ignores a released addon's late loss", async () => {
    const { gpu, addons, last } = setup().make();
    await gpu.attach();
    const stale = last().lossCb;
    gpu.detach();
    last().lose(); // released; the reload waits for the next attach
    last().lose(stale); // the same addon's late, second event
    await gpu.attach();
    expect(addons).toHaveLength(2);
    expect(last().disposed).toBe(false);
    expect(gpu.fellBack).toBe(false);
  });

  it('stays on the DOM renderer after repeated losses', async () => {
    const { make, tick } = setup();
    const { gpu, addons, last } = make();
    await gpu.attach();
    for (let i = 0; i < 3; i++) {
      tick(1_000);
      last().lose();
      await flush();
    }
    expect(gpu.fellBack).toBe(true);
    expect(gpu.loaded).toBe(false);
    expect(addons).toHaveLength(3);
    gpu.detach();
    await gpu.attach();
    expect(addons).toHaveLength(3);
  });
});
