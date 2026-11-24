import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import type { LspDiagnosticsEvent, LspServerStatus } from '@shared/lsp';
import { LanguageServerManager, type LanguageServerManagerOptions } from '../LanguageServerManager';
import type { ServerSpec } from '../serverRegistry';

const FAKE_SERVER = path.join(__dirname, 'fixtures', 'fakeServer.mjs');

function fakeSpec(env: Record<string, string> = {}, id = 'fake'): ServerSpec {
  return {
    id,
    name: 'Fake',
    extensions: { '.fk': 'fake' },
    resolve: () => ({
      ok: true,
      launch: {
        command: process.execPath,
        args: [FAKE_SERVER],
        env: { ELECTRON_RUN_AS_NODE: '1', ...env },
        source: 'bundled',
      },
    }),
    settings: () => ({ fake: { nested: { answer: 42 } } }),
  };
}

interface Hover {
  pid: number;
  uri: string;
  version: number;
  text: string;
  config: unknown;
}

async function waitFor<T>(probe: () => T | undefined | false, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('LanguageServerManager (fake server)', () => {
  let tmp: string;
  let manager: LanguageServerManager;
  let diagnostics: Array<{ owner: number } & LspDiagnosticsEvent>;
  let statuses: Array<{ worktree: string; servers: LspServerStatus[] }>;

  const worktree = (name: string): string => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const uriIn = (dir: string, file = 'a.fk'): string => URI.file(path.join(dir, file)).toString();

  const make = (opts: Partial<LanguageServerManagerOptions> = {}): LanguageServerManager => {
    manager = new LanguageServerManager({
      specs: [fakeSpec()],
      idleMs: 60_000,
      shutdownTimeoutMs: 1000,
      restart: { baseDelayMs: 10, maxDelayMs: 20 },
      onDiagnostics: (owner, event) => diagnostics.push({ owner, ...event }),
      onStatus: (wt, servers) => statuses.push({ worktree: wt, servers }),
      ...opts,
    });
    return manager;
  };
  const hover = (uri: string, owner = 1) =>
    manager.request(owner, {
      uri,
      method: 'textDocument/hover',
      params: { textDocument: { uri }, position: { line: 0, character: 0 } },
      requestId: `h-${Math.random()}`,
    }) as Promise<Hover>;
  const stateOf = (wt: string) => manager.status(wt)[0]?.state;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-lsp-')));
    diagnostics = [];
    statuses = [];
  });

  afterEach(async () => {
    await manager?.shutdownAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('starts nothing until a document opens, then routes its diagnostics', async () => {
    const wt = worktree('w1');
    make();
    expect(manager.status(wt)).toEqual([]);

    const uri = uriIn(wt);
    expect(manager.open(7, { worktree: wt, uri, version: 1, text: 'one' })).toEqual({
      serverId: 'fake',
    });
    expect(stateOf(wt)).toBe('starting');
    await waitFor(() => diagnostics.find((d) => d.version === 1));
    expect(diagnostics[0]).toMatchObject({ owner: 7, uri, version: 1 });
    expect(diagnostics[0]?.diagnostics[0]?.message).toBe('one');
    expect(stateOf(wt)).toBe('running');
    expect(statuses.at(-1)?.servers[0]).toMatchObject({ serverId: 'fake', state: 'running' });

    manager.change({ uri, version: 2, text: 'two' });
    await waitFor(() =>
      diagnostics.find((d) => d.version === 2 && d.diagnostics[0]?.message === 'two'),
    );
  });

  it('answers workspace/configuration from the spec settings', async () => {
    const wt = worktree('w1');
    make();
    const uri = uriIn(wt);
    manager.open(1, { worktree: wt, uri, version: 1, text: 'x' });
    let config: unknown = null;
    for (let i = 0; i < 100 && !config; i++) {
      config = (await hover(uri)).config;
      if (!config) await new Promise((r) => setTimeout(r, 20));
    }
    expect(config).toEqual([{ answer: 42 }, null]);
  });

  it('returns null and tracks nothing for files no server handles', () => {
    const wt = worktree('w1');
    make();
    expect(
      manager.open(1, { worktree: wt, uri: uriIn(wt, 'notes.md'), version: 1, text: '' }),
    ).toEqual({
      serverId: null,
    });
    expect(manager.status(wt)).toEqual([]);
    expect(() => manager.change({ uri: uriIn(wt, 'notes.md'), version: 2, text: '' })).toThrow(
      /not open/,
    );
  });

  it('pulls diagnostics from servers that only answer pulls', async () => {
    const wt = worktree('w1');
    make({ specs: [fakeSpec({ FAKE_PULL: '1' })] });
    const uri = uriIn(wt);
    manager.open(1, { worktree: wt, uri, version: 1, text: 'pulled' });
    await waitFor(() => diagnostics.find((d) => d.diagnostics[0]?.message === 'pulled'));
    manager.change({ uri, version: 2, text: 'again' });
    const d = await waitFor(() => diagnostics.find((x) => x.diagnostics[0]?.message === 'again'));
    expect(d.version).toBe(2);
  });

  it('shares one server per worktree and stops it only after the last document idles out', async () => {
    const wt = worktree('w1');
    make({ idleMs: 150 });
    const a = uriIn(wt, 'a.fk');
    const b = uriIn(wt, 'b.fk');
    manager.open(1, { worktree: wt, uri: a, version: 1, text: 'a' });
    manager.open(1, { worktree: wt, uri: b, version: 1, text: 'b' });
    const { pid } = await hover(a);
    expect((await hover(b)).pid).toBe(pid);

    manager.close(a);
    await new Promise((r) => setTimeout(r, 300));
    expect(stateOf(wt)).toBe('running');

    manager.close(b);
    await waitFor(() => manager.status(wt).length === 0);
    await waitFor(() => !isAlive(pid));
  });

  it('evicts the least recently used idle server first when at the cap', async () => {
    const [w1, w2, w3] = [worktree('w1'), worktree('w2'), worktree('w3')];
    make({ maxServers: 2 });
    manager.open(1, { worktree: w1, uri: uriIn(w1), version: 1, text: '1' });
    manager.open(1, { worktree: w2, uri: uriIn(w2), version: 1, text: '2' });
    const p1 = (await hover(uriIn(w1))).pid;
    await hover(uriIn(w2)); // w2 is now the more recent; w1 still has a document...
    manager.close(uriIn(w1)); // ...until now: w1 is idle, so it goes first.
    manager.open(1, { worktree: w3, uri: uriIn(w3), version: 1, text: '3' });
    await waitFor(() => !isAlive(p1));
    expect(manager.status(w1)).toEqual([]);
    expect(stateOf(w2)).toBe('running');
  });

  it('brings an evicted server back with its documents replayed', async () => {
    const [w1, w2] = [worktree('w1'), worktree('w2')];
    make({ maxServers: 1 });
    const u1 = uriIn(w1);
    manager.open(1, { worktree: w1, uri: u1, version: 1, text: 'first' });
    const p1 = (await hover(u1)).pid;
    manager.open(1, { worktree: w2, uri: uriIn(w2), version: 1, text: 'other' });
    await waitFor(() => !isAlive(p1));

    manager.change({ uri: u1, version: 2, text: 'edited while evicted' });
    const back = await hover(u1);
    expect(back.pid).not.toBe(p1);
    expect(back).toMatchObject({ version: 2, text: 'edited while evicted' });
  });

  it('restarts a crashed server and replays its documents', async () => {
    const wt = worktree('w1');
    make();
    const uri = uriIn(wt);
    manager.open(1, { worktree: wt, uri, version: 1, text: 'alive' });
    const { pid } = await hover(uri);
    process.kill(pid, 'SIGKILL');
    await waitFor(() => statuses.some((s) => s.servers[0]?.state === 'restarting'));
    const again = await hover(uri);
    expect(again.pid).not.toBe(pid);
    expect(again.text).toBe('alive');
  });

  it('gives up after too many crashes and reports the server failed', async () => {
    const wt = worktree('w1');
    make({ restart: { maxRestarts: 2, baseDelayMs: 5, maxDelayMs: 10 } });
    const uri = uriIn(wt);
    manager.open(1, { worktree: wt, uri, version: 1, text: 'CRASH on every replay' });
    await waitFor(() => stateOf(wt) === 'failed');
    expect(manager.status(wt)[0]?.message).toMatch(/exited/);
    await expect(hover(uri)).rejects.toMatchObject({ code: 'UNAVAILABLE' });

    // Re-opening the file is the retry.
    manager.open(1, { worktree: wt, uri, version: 2, text: 'fixed' });
    expect((await hover(uri)).text).toBe('fixed');
  });

  it('cancels a request on lsp:cancel', async () => {
    const wt = worktree('w1');
    make();
    const uri = uriIn(wt);
    manager.open(3, { worktree: wt, uri, version: 1, text: 'x' });
    await hover(uri, 3);
    const pending = manager.request(3, {
      uri,
      method: 'textDocument/completion',
      params: { textDocument: { uri }, position: { line: 0, character: 0 } },
      requestId: 'c1',
    });
    manager.cancel(3, 'c1');
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('routes diagnostics to the owner, and drops them for closed documents', async () => {
    const wt = worktree('w1');
    make();
    const a = uriIn(wt, 'a.fk');
    const b = uriIn(wt, 'b.fk');
    manager.open(1, { worktree: wt, uri: a, version: 1, text: 'a' });
    manager.open(2, { worktree: wt, uri: b, version: 1, text: 'b' });
    await waitFor(() => diagnostics.length >= 2);
    expect(diagnostics.find((d) => d.uri === a)?.owner).toBe(1);
    expect(diagnostics.find((d) => d.uri === b)?.owner).toBe(2);

    manager.closeOwner(2);
    expect(() => manager.change({ uri: b, version: 2, text: 'b2' })).toThrow(/not open/);
  });

  it('speaks realpaths to the server but answers in the renderer URI', async () => {
    const real = worktree('real');
    const link = path.join(tmp, 'link');
    fs.symlinkSync(real, link);
    make();
    const uri = uriIn(link);
    manager.open(1, { worktree: link, uri, version: 1, text: 'via link' });
    const d = await waitFor(() => diagnostics[0]);
    expect(d.uri).toBe(uri);
    expect((await hover(uri)).uri).toBe(URI.file(path.join(real, 'a.fk')).toString());
    expect(stateOf(real)).toBe('running');
  });

  it('disposes a worktree: its servers stop and its documents are forgotten', async () => {
    const [w1, w2] = [worktree('w1'), worktree('w2')];
    make();
    manager.open(1, { worktree: w1, uri: uriIn(w1), version: 1, text: '1' });
    manager.open(1, { worktree: w2, uri: uriIn(w2), version: 1, text: '2' });
    const p1 = (await hover(uriIn(w1))).pid;
    const p2 = (await hover(uriIn(w2))).pid;

    await manager.disposeWorktree(w1);
    expect(isAlive(p1)).toBe(false);
    expect(isAlive(p2)).toBe(true);
    expect(() => manager.change({ uri: uriIn(w1), version: 2, text: '' })).toThrow(/not open/);
  });

  it('shuts every server down on quit, killing one that ignores shutdown', async () => {
    const [w1, w2] = [worktree('w1'), worktree('w2')];
    make({
      specs: [
        fakeSpec(),
        { ...fakeSpec({ FAKE_HANG_SHUTDOWN: '1' }, 'hang'), extensions: { '.hg': 'hang' } },
      ],
      shutdownTimeoutMs: 300,
    });
    manager.open(1, { worktree: w1, uri: uriIn(w1), version: 1, text: '1' });
    manager.open(1, { worktree: w2, uri: uriIn(w2, 'x.hg'), version: 1, text: '2' });
    const pids = [(await hover(uriIn(w1))).pid, (await hover(uriIn(w2, 'x.hg'))).pid];

    await manager.shutdownAll();
    expect(pids.map(isAlive)).toEqual([false, false]);
    expect(manager.status(w1)).toEqual([]);
  });

  it('reports a server it cannot resolve as unavailable', async () => {
    const wt = worktree('w1');
    make({
      specs: [
        { ...fakeSpec(), resolve: () => ({ ok: false, reason: 'fakels was not found on PATH' }) },
      ],
    });
    const uri = uriIn(wt);
    expect(manager.open(1, { worktree: wt, uri, version: 1, text: '' }).serverId).toBe('fake');
    expect(manager.status(wt)).toEqual([
      {
        serverId: 'fake',
        name: 'Fake',
        state: 'unavailable',
        message: 'fakels was not found on PATH',
        source: undefined,
      },
    ]);
    await expect(hover(uri)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
