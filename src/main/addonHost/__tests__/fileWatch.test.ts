import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { watchDirectory } from '../fileWatch';

/**
 * Poll until `check` passes, running `poke` each round. macOS fs.watch can miss
 * a write made right after the watcher arms (worse under load), so the tests
 * keep rewriting the file instead of depending on one event being seen.
 */
const until = async (check: () => boolean, poke: () => void = () => {}, ms = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    poke();
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe('watchDirectory', () => {
  const disposers: Array<() => void> = [];
  const roots: string[] = [];
  afterEach(() => {
    for (const d of disposers.splice(0)) d();
    for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  });

  const tmp = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-watch-'));
    roots.push(root);
    return root;
  };

  it('fires with the changed file names', async () => {
    const dir = tmp();
    const calls: string[][] = [];
    disposers.push(watchDirectory(dir, (f) => calls.push(f), { debounceMs: 20 }));
    await until(
      () => calls.flat().includes('ports.json'),
      () => fs.writeFileSync(path.join(dir, 'ports.json'), '{}'),
    );
  });

  it('waits for a missing directory, then watches it', async () => {
    const dir = path.join(tmp(), '.dash');
    const calls: string[][] = [];
    disposers.push(watchDirectory(dir, (f) => calls.push(f), { debounceMs: 20, retryMs: 30 }));
    await new Promise((r) => setTimeout(r, 60));
    fs.mkdirSync(dir);
    await until(
      () => calls.flat().includes('ports.json'),
      () => fs.writeFileSync(path.join(dir, 'ports.json'), '{}'),
    );
  });

  it('stops after dispose', async () => {
    const dir = tmp();
    const calls: string[][] = [];
    const dispose = watchDirectory(dir, (f) => calls.push(f), { debounceMs: 20 });
    dispose();
    fs.writeFileSync(path.join(dir, 'x'), '1');
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toEqual([]);
  });
});
