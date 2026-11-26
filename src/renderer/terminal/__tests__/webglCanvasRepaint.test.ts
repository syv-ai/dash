import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { repaintOnCanvasResize } from '../webglCanvasRepaint';

/** A ResizeObserver whose callbacks the test fires by hand. */
class FakeObserver {
  static last: FakeObserver | null = null;
  observed: { target: unknown; options: unknown }[] = [];
  disconnected = false;
  constructor(readonly fire: () => void) {
    FakeObserver.last = this;
  }
  observe(target: unknown, options: unknown) {
    this.observed.push({ target, options });
  }
  disconnect() {
    this.disconnected = true;
  }
}

const canvas = {} as HTMLCanvasElement;
const terminalWith = (renderService: object | undefined, rows = 40) =>
  ({ rows, _core: { _renderService: renderService } }) as unknown as Terminal;

describe('repaintOnCanvasResize', () => {
  beforeEach(() => {
    FakeObserver.last = null;
    vi.stubGlobal('ResizeObserver', FakeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders every row in the callback that sees the canvas resize, not a frame later', () => {
    const renderRows = vi.fn();
    repaintOnCanvasResize(terminalWith({ _renderRows: renderRows }), canvas);
    const observer = FakeObserver.last!;
    expect(observer.observed).toEqual([
      { target: canvas, options: { box: 'device-pixel-content-box' } },
    ]);
    observer.fire();
    expect(renderRows).toHaveBeenCalledWith(0, 39);
  });

  it('disconnects', () => {
    const stop = repaintOnCanvasResize(terminalWith({ _renderRows: vi.fn() }), canvas);
    stop();
    expect(FakeObserver.last!.disconnected).toBe(true);
  });

  it('observes nothing when xterm no longer has the internal render', () => {
    repaintOnCanvasResize(terminalWith({}), canvas);
    repaintOnCanvasResize(terminalWith(undefined), canvas);
    expect(FakeObserver.last).toBeNull();
  });
});
