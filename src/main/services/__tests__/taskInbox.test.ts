import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {
  InboxWriteError,
  findTaskMessage,
  forgetTask,
  getTaskInbox,
  postToInbox,
  recordTaskMessage,
  resetTaskInboxes,
  setTaskInbox,
  taskMessages,
} from '../taskInbox';

const servers: net.Server[] = [];
const dirs: string[] = [];

/** A unix socket server that records each connection's bytes. */
async function inboxServer(
  onConnection?: (socket: net.Socket) => void,
): Promise<{ socket: string; connections: string[] }> {
  // Short path: unix socket paths are capped near 104 bytes on macOS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-'));
  dirs.push(dir);
  const socket = path.join(dir, 's.sock');
  const connections: string[] = [];
  const server = net.createServer((conn) => {
    const i = connections.push('') - 1;
    conn.on('data', (d) => (connections[i] += d.toString()));
    onConnection?.(conn);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  return { socket, connections };
}

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  resetTaskInboxes();
});

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('postToInbox', () => {
  it('writes the auth line and the user line on one connection, then closes', async () => {
    const server = await inboxServer();
    await postToInbox({ socket: server.socket, token: 'tok' }, 'hello\nthere');
    await until(() => server.connections[0]?.endsWith('\n') ?? false);
    expect(server.connections).toHaveLength(1);
    const lines = server.connections[0]!.split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ type: 'auth', token: 'tok' });
    expect(JSON.parse(lines[1]!)).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello\nthere' },
    });
    expect(lines[2]).toBe('');
  });

  it('fails without retrying, as not delivered, when the socket is gone', async () => {
    const err = await postToInbox(
      { socket: '/tmp/no-such-dash-inbox.sock', token: 't' },
      'x',
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InboxWriteError);
    expect((err as InboxWriteError).delivered).toBe('no');
    expect((err as Error).message).toContain('no longer taking messages');
  });

  it('opens one connection even when the session drops it at once', async () => {
    const server = await inboxServer((conn) => conn.destroy());
    await postToInbox({ socket: server.socket, token: 't' }, 'x').catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(server.connections).toHaveLength(1);
  });
});

describe('inbox and message store', () => {
  it('keeps an inbox per task and forgets it with the task', () => {
    setTaskInbox('t', { socket: '/s', token: 'k', transcriptPath: null });
    expect(getTaskInbox('t')?.socket).toBe('/s');
    recordTaskMessage('t', {
      messageId: 'm_1',
      sentAt: 1,
      queued: false,
      noReply: false,
      transcriptPath: null,
    });
    forgetTask('t');
    expect(getTaskInbox('t')).toBeUndefined();
    expect(findTaskMessage('t', 'm_1')).toBeUndefined();
  });

  it('keeps the last 20 messages per task', () => {
    for (let i = 0; i < 25; i++) {
      recordTaskMessage('t', {
        messageId: `m_${i}`,
        sentAt: i,
        queued: false,
        noReply: false,
        transcriptPath: null,
      });
    }
    expect(taskMessages('t')).toHaveLength(20);
    expect(findTaskMessage('t', 'm_4')).toBeUndefined();
    expect(findTaskMessage('t', 'm_24')).toBeDefined();
  });
});
