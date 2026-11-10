import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// A fake fs.watch: the test fires events by hand, and fake timers drive the
// debounce, so the timing is exact.
type Listener = (eventType: string, filename: string | null) => void;
const watches: {
  dir: string;
  listener: Listener;
  watcher: EventEmitter & { close: () => void };
}[] = [];

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    watch: vi.fn((dir: string, listener: Listener) => {
      if (dir === '/missing') throw new Error('ENOENT');
      const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
      watches.push({ dir, listener, watcher });
      return watcher;
    }),
  };
});

import { watchDir } from '../watchDir';

beforeEach(() => {
  watches.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('watchDir', () => {
  it('calls onChange once, debounceMs after the last event', () => {
    const onChange = vi.fn();
    watchDir('/d', { debounceMs: 500, onChange });
    const { listener } = watches[0]!;
    listener('change', 'a');
    vi.advanceTimersByTime(400);
    listener('rename', 'b');
    vi.advanceTimersByTime(499);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('only counts events the filter accepts, and drops nameless ones', () => {
    const onChange = vi.fn();
    const filter = vi.fn((name: string) => name === 'ports.json');
    watchDir('/d', { filter, debounceMs: 10, onChange });
    const { listener } = watches[0]!;
    listener('change', 'other.json');
    listener('change', null);
    vi.advanceTimersByTime(50);
    expect(onChange).not.toHaveBeenCalled();
    expect(filter).toHaveBeenCalledWith('other.json', 'change');
    listener('rename', 'ports.json');
    vi.advanceTimersByTime(10);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('close cancels a pending onChange and closes the watcher', () => {
    const onChange = vi.fn();
    const close = watchDir('/d', { debounceMs: 10, onChange });
    watches[0]!.listener('change', 'x');
    close();
    vi.advanceTimersByTime(50);
    expect(onChange).not.toHaveBeenCalled();
    expect(watches[0]!.watcher.close).toHaveBeenCalled();
  });

  it('swallows watch errors', () => {
    watchDir('/d', { debounceMs: 10, onChange: () => {} });
    expect(() => watches[0]!.watcher.emit('error', new Error('gone'))).not.toThrow();
  });

  it('throws when the folder cannot be watched', () => {
    expect(() => watchDir('/missing', { debounceMs: 10, onChange: () => {} })).toThrow();
  });
});
