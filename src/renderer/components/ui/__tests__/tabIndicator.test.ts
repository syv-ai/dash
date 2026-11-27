import { describe, expect, it } from 'vitest';
import { boxIn, type LaidOut } from '../TabIndicator';

const box = (o: Partial<LaidOut> = {}): LaidOut => ({
  offsetLeft: 0,
  offsetTop: 0,
  offsetWidth: 0,
  offsetHeight: 0,
  offsetParent: null,
  clientLeft: 0,
  clientTop: 0,
  scrollLeft: 0,
  scrollTop: 0,
  ...o,
});

describe('boxIn', () => {
  it('places a tab whose offset parent is the host at its offsets and size', () => {
    const host = box({ scrollLeft: 40 });
    const tab = box({
      offsetLeft: 60,
      offsetTop: 6,
      offsetWidth: 52,
      offsetHeight: 24,
      offsetParent: host,
    });
    // The host's own scroll doesn't count: the surface scrolls with its tabs.
    expect(boxIn(host, tab)).toEqual({ x: 60, y: 6, w: 52, h: 24 });
  });

  it('adds a positioned box between them, its border, less its scroll', () => {
    const host = box();
    const track = box({
      offsetLeft: 6,
      offsetTop: 2,
      clientLeft: 1,
      clientTop: 1,
      scrollLeft: 30,
      offsetParent: host,
    });
    const tab = box({
      offsetLeft: 100,
      offsetTop: 4,
      offsetWidth: 40,
      offsetHeight: 24,
      offsetParent: track,
    });
    expect(boxIn(host, tab)).toEqual({ x: 6 + 1 - 30 + 100, y: 2 + 1 + 4, w: 40, h: 24 });
  });
});
