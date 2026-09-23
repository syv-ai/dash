import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { watchDirectory } from '../fileWatch';

const until = async (check: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
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
    fs.writeFileSync(path.join(dir, 'ports.json'), '{}');
    await until(() => calls.length > 0);
    expect(calls.flat()).toContain('ports.json');
  });

  it('waits for a missing directory, then watches it', async () => {
    const dir = path.join(tmp(), '.dash');
    const calls: string[][] = [];
    disposers.push(watchDirectory(dir, (f) => calls.push(f), { debounceMs: 20, retryMs: 30 }));
    await new Promise((r) => setTimeout(r, 60));
    fs.mkdirSync(dir);
    await new Promise((r) => setTimeout(r, 80)); // let the retry arm the watcher
    fs.writeFileSync(path.join(dir, 'ports.json'), '{}');
    await until(() => calls.flat().includes('ports.json'));
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
