import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

import { watchProjectMemory, stopWatchingMemory, setMemoryChangeNotifier } from '../MemoryWatcher';
import { resolveMemoryDir } from '../MemoryService';

let tmp: string;
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-memwatch-')));
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
  fs.mkdirSync(path.join(tmp, 'claude'), { recursive: true });
});

afterEach(() => {
  stopWatchingMemory();
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('MemoryWatcher', () => {
  it('notifies when a memory is written into an existing folder', async () => {
    const project = path.join(tmp, 'plain-a');
    fs.mkdirSync(project);
    const dir = await resolveMemoryDir(project);
    fs.mkdirSync(dir, { recursive: true });
    const seen: string[] = [];
    setMemoryChangeNotifier((p) => seen.push(p));
    await watchProjectMemory(project);
    fs.writeFileSync(path.join(dir, 'a.md'), 'x');
    await waitFor(() => seen.length > 0);
    expect(seen).toEqual([project]);
  });

  it('picks up a memory folder created after the watch started', async () => {
    const project = path.join(tmp, 'plain-b');
    fs.mkdirSync(project);
    const seen: string[] = [];
    setMemoryChangeNotifier((p) => seen.push(p));
    await watchProjectMemory(project);
    const dir = await resolveMemoryDir(project);
    fs.mkdirSync(dir, { recursive: true });
    await waitFor(() => seen.length > 0);
    seen.length = 0;
    fs.writeFileSync(path.join(dir, 'late.md'), 'x');
    await waitFor(() => seen.length > 0);
    expect(seen[0]).toBe(project);
  });

  it('stops notifying after stopWatchingMemory', async () => {
    const project = path.join(tmp, 'plain-c');
    fs.mkdirSync(project);
    const dir = await resolveMemoryDir(project);
    fs.mkdirSync(dir, { recursive: true });
    const seen: string[] = [];
    setMemoryChangeNotifier((p) => seen.push(p));
    await watchProjectMemory(project);
    stopWatchingMemory();
    fs.writeFileSync(path.join(dir, 'b.md'), 'x');
    await new Promise((r) => setTimeout(r, 600));
    expect(seen).toEqual([]);
  });
});
