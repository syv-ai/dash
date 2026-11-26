import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as os from 'os';

// A fake fs.watch: the test fires events by hand, and fake timers drive the
// debounce. The watched folder is a real one, so `existsSync` finds it.
type Listener = (eventType: string, filename: string | null) => void;
const watches: {
  dir: string;
  recursive: boolean;
  listener: Listener;
  watcher: EventEmitter & { close: () => void };
}[] = [];

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    watch: vi.fn((dir: string, opts: { recursive?: boolean }, listener: Listener) => {
      const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
      watches.push({ dir, recursive: !!opts.recursive, listener, watcher });
      return watcher;
    }),
  };
});

const broadcast = vi.fn();
vi.mock('../../utils/broadcast', () => ({ broadcast: (...a: unknown[]) => broadcast(...a) }));

import {
  WORKING_TREE_DEBOUNCE_MS,
  isUnwatchedPath,
  stopWorkingTreeWatches,
  unwatchWorkingTree,
  watchWorkingTree,
} from '../WorkingTreeWatcher';

const cwd = os.tmpdir();

beforeEach(() => {
  watches.length = 0;
  broadcast.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  stopWorkingTreeWatches();
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTime(WORKING_TREE_DEBOUNCE_MS);

describe('WorkingTreeWatcher', () => {
  it('watches the whole tree and reports a folder moved or deleted out of it', () => {
    watchWorkingTree(cwd);
    expect(watches).toHaveLength(1);
    expect(watches[0]!.recursive).toBe(true);
    // FSEvents reports `mv dir out` and `rm -rf dir` as renames of the paths.
    watches[0]!.listener('rename', 'smoke-review/shots-truncate');
    settle();
    expect(broadcast).toHaveBeenCalledExactlyOnceWith('editor:treeChanged', { cwd });
  });

  it("ignores git's own bookkeeping, which every status poll may touch", () => {
    watchWorkingTree(cwd);
    const { listener } = watches[0]!;
    listener('change', '.git/index');
    listener('rename', '.git/index.lock');
    listener('change', '.git');
    settle();
    expect(broadcast).not.toHaveBeenCalled();
    listener('change', '.github/workflows/ci.yml');
    settle();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("skips churn the tree has no use for: node_modules and the tasks' worktrees", () => {
    expect(isUnwatchedPath('node_modules/react/index.js')).toBe(true);
    expect(isUnwatchedPath('packages/app/node_modules/.vite/deps.js')).toBe(true);
    expect(isUnwatchedPath('.claude/worktrees/task-1/src/a.ts')).toBe(true);
    // The folders themselves coming or going are rows in the tree.
    expect(isUnwatchedPath('node_modules')).toBe(false);
    expect(isUnwatchedPath('.claude/worktrees/task-1')).toBe(false);
    expect(isUnwatchedPath('.claude/settings.local.json')).toBe(false);
    expect(isUnwatchedPath('.gitignore')).toBe(false);
    expect(isUnwatchedPath('src/node_modules.ts')).toBe(false);
  });

  it('counts a nameless event as a change', () => {
    watchWorkingTree(cwd);
    watches[0]!.listener('rename', null);
    settle();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it('shares one watch per folder until its last watcher leaves', () => {
    watchWorkingTree(cwd);
    watchWorkingTree(cwd);
    expect(watches).toHaveLength(1);
    unwatchWorkingTree(cwd);
    expect(watches[0]!.watcher.close).not.toHaveBeenCalled();
    unwatchWorkingTree(cwd);
    expect(watches[0]!.watcher.close).toHaveBeenCalled();
    watches[0]!.listener('rename', 'a');
    settle();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
