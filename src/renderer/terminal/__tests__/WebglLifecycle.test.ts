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
  dispose() {
    this.disposed = true;
    this.lossCb = null; // like xterm, dispose drops the addon's listeners
  }
  onContextLoss(cb: () => void) {
    this.lossCb = cb;
  }
  /** Fire a loss even after dispose, to model a late event. */
  lose(cb = this.lossCb) {
    cb?.();
  }
}

function setup() {
  let t = 0;
  const addons: FakeAddon[] = [];
  const installed: FakeAddon[] = [];
  const loseContext = vi.fn();
  const order: string[] = [];
  const gpu = new WebglLifecycle<FakeAddon>({
    create: async () => {
      const a = new FakeAddon();
      const dispose = a.dispose.bind(a);
      a.dispose = () => {
        order.push('dispose');
        dispose();
      };
      addons.push(a);
      return a;
    },
    install: (a) => installed.push(a),
    findContext: () => ({
      getExtension: () => ({
        loseContext: () => {
          order.push('loseContext');
          loseContext();
        },
      }),
    }),
    now: () => t,
  });
  return { gpu, addons, installed, loseContext, order, tick: (ms: number) => (t += ms) };
}

function nth(addons: FakeAddon[], i: number): FakeAddon {
  const a = addons[i];
  if (!a) throw new Error(`no addon ${i}`);
  return a;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('WebglLifecycle', () => {
  it('loads on attach and loads once across repeated attaches', async () => {
    const { gpu, installed } = setup();
    await gpu.attach();
    await gpu.attach();
    expect(installed).toHaveLength(1);
    expect(gpu.loaded).toBe(true);
  });

  it('releases on detach: disposes, then loses the context', async () => {
    const { gpu, addons, loseContext, order } = setup();
    await gpu.attach();
    gpu.detach();
    expect(nth(addons, 0).disposed).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['dispose', 'loseContext']);
    expect(gpu.loaded).toBe(false);
  });

  it('loads a new addon on re-attach', async () => {
    const { gpu, installed } = setup();
    await gpu.attach();
    gpu.detach();
    await gpu.attach();
    expect(installed).toHaveLength(2);
    expect(gpu.loaded).toBe(true);
  });

  it('skips the load when detached while the addon was being created', async () => {
    const { gpu, installed } = setup();
    const pending = gpu.attach();
    gpu.detach();
    await pending;
    expect(installed).toHaveLength(0);
    expect(gpu.loaded).toBe(false);
  });

  it('reloads after a loss while attached', async () => {
    const { gpu, addons, installed } = setup();
    await gpu.attach();
    nth(addons, 0).lose();
    await flush();
    expect(nth(addons, 0).disposed).toBe(true);
    expect(installed).toHaveLength(2);
    expect(gpu.loaded).toBe(true);
  });

  it("ignores a released addon's late loss and does not reload while detached", async () => {
    const { gpu, addons, installed } = setup();
    await gpu.attach();
    const staleCb = nth(addons, 0).lossCb;
    gpu.detach();
    nth(addons, 0).lose(staleCb);
    await flush();
    expect(installed).toHaveLength(1);
    expect(gpu.loaded).toBe(false);
    await gpu.attach();
    expect(installed).toHaveLength(2);
  });

  it('stays on the DOM renderer after repeated losses', async () => {
    const { gpu, addons, installed, tick } = setup();
    await gpu.attach();
    for (let i = 0; i < 3; i++) {
      tick(1_000);
      nth(addons, addons.length - 1).lose();
      await flush();
    }
    expect(gpu.fellBack).toBe(true);
    expect(gpu.loaded).toBe(false);
    expect(installed).toHaveLength(3);
    gpu.detach();
    await gpu.attach();
    expect(installed).toHaveLength(3);
  });
});
