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

  it('keeps notifying after the memory folder is deleted and recreated', async () => {
    const project = path.join(tmp, 'plain-d');
    fs.mkdirSync(project);
    const dir = await resolveMemoryDir(project);
    fs.mkdirSync(dir, { recursive: true });
    const seen: string[] = [];
    setMemoryChangeNotifier((p) => seen.push(p));
    await watchProjectMemory(project);
    fs.rmSync(dir, { recursive: true });
    fs.mkdirSync(dir);
    await waitFor(() => seen.length > 0);
    seen.length = 0;
    fs.writeFileSync(path.join(dir, 'after.md'), 'x');
    await waitFor(() => seen.length > 0);
    expect(seen[0]).toBe(project);
  });

  it('ignores transcript writes while memory/ does not exist yet', async () => {
    const project = path.join(tmp, 'plain-e');
    fs.mkdirSync(project);
    const transcripts = path.dirname(await resolveMemoryDir(project));
    fs.mkdirSync(transcripts, { recursive: true });
    const seen: string[] = [];
    setMemoryChangeNotifier((p) => seen.push(p));
    await watchProjectMemory(project);
    fs.writeFileSync(path.join(transcripts, 'session.jsonl'), '{}\n');
    fs.appendFileSync(path.join(transcripts, 'session.jsonl'), '{}\n');
    await new Promise((r) => setTimeout(r, 600));
    expect(seen).toEqual([]);
  });

  it('drops a watch whose folder lookup resolves after it was superseded', async () => {
    const stale = path.join(tmp, 'plain-f');
    const current = path.join(tmp, 'plain-g');
    fs.mkdirSync(stale);
    fs.mkdirSync(current);
    const staleDir = await resolveMemoryDir(stale);
    const currentDir = await resolveMemoryDir(current);
    fs.mkdirSync(staleDir, { recursive: true });
    fs.mkdirSync(currentDir, { recursive: true });
    const seen: string[] = [];
    setMemoryChangeNotifier((p) => seen.push(p));
    const superseded = watchProjectMemory(stale); // not awaited: the modal switched project
    await watchProjectMemory(current);
    await superseded;
    fs.writeFileSync(path.join(staleDir, 'a.md'), 'x');
    fs.writeFileSync(path.join(currentDir, 'b.md'), 'x');
    await waitFor(() => seen.length > 0);
    await new Promise((r) => setTimeout(r, 400));
    expect(seen).toEqual([current]);
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
