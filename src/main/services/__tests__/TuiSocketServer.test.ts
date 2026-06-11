import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { TuiSocketServer } from '../TuiSocketServer';
import type { MainToTui, TuiToMain } from '../../../shared/portsTuiProtocol';

const SOCK_DIR = path.join(os.tmpdir(), `tui-test-${process.pid}`);

beforeEach(() => fs.mkdirSync(SOCK_DIR, { recursive: true }));
afterEach(() => {
  try {
    fs.rmSync(SOCK_DIR, { recursive: true, force: true });
  } catch {
    /* ok */
  }
});

function freshSockPath(): string {
  return path.join(SOCK_DIR, `s-${Math.random().toString(36).slice(2)}.sock`);
}

describe('TuiSocketServer', () => {
  it('parses newline-delimited JSON messages from the client', async () => {
    const sockPath = freshSockPath();
    const server = new TuiSocketServer(sockPath);
    const received: TuiToMain[] = [];
    server.onMessage((m) => received.push(m));
    await server.listen();

    const client = net.createConnection(sockPath);
    await new Promise<void>((res) => client.once('connect', () => res()));

    const m1: TuiToMain = { type: 'ready', version: 1 };
    const m2: TuiToMain = { type: 'choice', screen: 'onboarding', value: 'setup' };
    client.write(JSON.stringify(m1) + '\n' + JSON.stringify(m2) + '\n');

    await new Promise((r) => setTimeout(r, 50));
    client.end();
    await server.close();

    expect(received).toEqual([m1, m2]);
  });

  it('recovers from a malformed JSON line and continues parsing', async () => {
    const sockPath = freshSockPath();
    const server = new TuiSocketServer(sockPath);
    const received: TuiToMain[] = [];
    const errors: string[] = [];
    server.onMessage((m) => received.push(m));
    server.onError((e) => errors.push(e.message));
    await server.listen();

    const client = net.createConnection(sockPath);
    await new Promise<void>((res) => client.once('connect', () => res()));

    client.write('not json\n' + JSON.stringify({ type: 'ready', version: 1 }) + '\n');
    await new Promise((r) => setTimeout(r, 50));
    client.end();
    await server.close();

    expect(errors.length).toBe(1);
    expect(received).toEqual([{ type: 'ready', version: 1 }]);
  });

  it('sends framed messages to the connected client', async () => {
    const sockPath = freshSockPath();
    const server = new TuiSocketServer(sockPath);
    await server.listen();

    const client = net.createConnection(sockPath);
    const lines: string[] = [];
    let buf = '';
    client.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const parts = buf.split('\n');
      buf = parts.pop()!;
      for (const p of parts) if (p) lines.push(p);
    });
    await new Promise<void>((res) => client.once('connect', () => res()));
    // Wait one tick so the server's connection handler attaches before we send.
    await new Promise((r) => setTimeout(r, 20));

    const msg: MainToTui = { type: 'show', screen: 'waiting-ports-json' };
    await server.send(msg);
    await new Promise((r) => setTimeout(r, 50));
    client.end();
    await server.close();

    expect(lines).toEqual([JSON.stringify(msg)]);
  });

  it('unlinks an orphan socket file before listening', async () => {
    const sockPath = freshSockPath();
    fs.writeFileSync(sockPath, ''); // simulate orphan
    const server = new TuiSocketServer(sockPath);
    await expect(server.listen()).resolves.toBeUndefined();
    await server.close();
  });

  it('emits a close event when the client disconnects', async () => {
    const sockPath = freshSockPath();
    const server = new TuiSocketServer(sockPath);
    let closed = false;
    server.onClose(() => {
      closed = true;
    });
    await server.listen();

    const client = net.createConnection(sockPath);
    await new Promise<void>((res) => client.once('connect', () => res()));
    client.end();
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(true);
    await server.close();
  });
});
