import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  setMemoryChangeNotifier,
  stopAllMemoryWatches,
  syncMemoryWatches,
  watchedMemoryDir,
} from '../MemoryWatcher';
import { newMemoryCount, resolveMemoryDir } from '../MemoryService';

let tmp: string;
let seen: string[];
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

async function waitFor(check: () => boolean, ms = 15_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Write `file` until the watcher reports a change. A watch just started can
 * miss the first write (macOS starts its FSEvents stream asynchronously), and
 * under a loaded test run that window grows.
 */
async function writeUntilSeen(file: string, ms = 15_000): Promise<void> {
  const start = Date.now();
  while (seen.length === 0) {
    if (Date.now() - start > ms) throw new Error('timed out');
    fs.writeFileSync(file, String(Date.now()));
    // Longer than the watcher's debounce, which each write would otherwise restart.
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const quiet = () => new Promise((r) => setTimeout(r, 600));

/** A plain (non-git) project folder, and the memory folder Claude would give it. */
async function project(name: string): Promise<{ id: string; path: string; dir: string }> {
  const p = path.join(tmp, name);
  fs.mkdirSync(p);
  return { id: name, path: p, dir: await resolveMemoryDir(p) };
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-memwatch-')));
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
  fs.mkdirSync(path.join(tmp, 'claude'), { recursive: true });
  seen = [];
  setMemoryChangeNotifier((id) => seen.push(id));
});

afterEach(() => {
  stopAllMemoryWatches();
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// FSEvents can lag by seconds while the full suite loads the machine.
describe('MemoryWatcher', { timeout: 20_000 }, () => {
  it('notifies the project whose memory was written, of all the watched ones', async () => {
    const a = await project('a');
    const b = await project('b');
    fs.mkdirSync(a.dir, { recursive: true });
    fs.mkdirSync(b.dir, { recursive: true });
    await syncMemoryWatches([a, b]);
    await writeUntilSeen(path.join(b.dir, 'x.md'));
    await quiet();
    expect(seen).toEqual(['b']);
  });

  it('picks up a memory folder created after the watch started', async () => {
    const a = await project('a');
    await syncMemoryWatches([a]);
    await quiet(); // let the ancestor's watch start
    fs.mkdirSync(a.dir, { recursive: true });
    await waitFor(() => seen.length > 0);
    seen.length = 0;
    await writeUntilSeen(path.join(a.dir, 'late.md'));
    expect(seen[0]).toBe('a');
  });

  it('keeps notifying after the memory folder is deleted and recreated', async () => {
    const a = await project('a');
    fs.mkdirSync(a.dir, { recursive: true });
    await syncMemoryWatches([a]);
    await writeUntilSeen(path.join(a.dir, 'before.md'));
    await quiet();
    seen.length = 0;
    fs.rmSync(a.dir, { recursive: true });
    fs.mkdirSync(a.dir);
    await waitFor(() => seen.length > 0);
    seen.length = 0;
    await writeUntilSeen(path.join(a.dir, 'after.md'));
    expect(seen[0]).toBe('a');
  });

  it('ignores transcript writes while memory/ does not exist yet', async () => {
    const a = await project('a');
    const transcripts = path.dirname(a.dir);
    fs.mkdirSync(transcripts, { recursive: true });
    await syncMemoryWatches([a]);
    fs.writeFileSync(path.join(transcripts, 'session.jsonl'), '{}\n');
    fs.appendFileSync(path.join(transcripts, 'session.jsonl'), '{}\n');
    await quiet();
    expect(seen).toEqual([]);
  });

  it('stops watching a project once it is no longer listed', async () => {
    const a = await project('a');
    const b = await project('b');
    fs.mkdirSync(a.dir, { recursive: true });
    await syncMemoryWatches([a, b]);
    await syncMemoryWatches([b]);
    expect(watchedMemoryDir('a')).toBeUndefined();
    expect(watchedMemoryDir('b')).toBe(b.dir);
    fs.writeFileSync(path.join(a.dir, 'gone.md'), 'x');
    await quiet();
    expect(seen).toEqual([]);
  });
});

describe('newMemoryCount', () => {
  it('counts the memories changed since the last look, and none for a missing folder', async () => {
    const a = await project('a');
    expect(await newMemoryCount(a.dir, 0)).toBe(0);
    fs.mkdirSync(a.dir, { recursive: true });
    fs.writeFileSync(path.join(a.dir, 'old.md'), 'x');
    fs.writeFileSync(path.join(a.dir, 'new.md'), 'x');
    fs.writeFileSync(path.join(a.dir, 'MEMORY.md'), 'x');
    const t = Date.now() / 1000;
    fs.utimesSync(path.join(a.dir, 'old.md'), t - 100, t - 100);
    expect(await newMemoryCount(a.dir, Date.now() - 50_000)).toBe(1);
    expect(await newMemoryCount(a.dir, null)).toBe(0);
  });
});
