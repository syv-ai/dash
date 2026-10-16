import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSessionEntry, readLiveSessions } from '../claudeSessionRegistry';

let dir: string;
let sessionsDir: string;
let sock: string;

const entry = (extra: Record<string, unknown> = {}) => ({
  pid: process.pid,
  sessionId: 'sess-1',
  cwd: '/wt',
  kind: 'bg',
  jobId: 'job-1',
  messagingSocketPath: sock,
  status: 'idle',
  updatedAt: 1,
  ...extra,
});

function write(name: string, body: unknown): void {
  fs.writeFileSync(
    path.join(sessionsDir, name),
    typeof body === 'string' ? body : JSON.stringify(body),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-sessions-'));
  sessionsDir = path.join(dir, 'sessions');
  fs.mkdirSync(sessionsDir);
  sock = path.join(dir, 'live.sock');
  fs.writeFileSync(sock, '');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('parseSessionEntry', () => {
  it('reads the fields Dash uses', () => {
    expect(parseSessionEntry(JSON.stringify(entry()))).toEqual({
      pid: process.pid,
      sessionId: 'sess-1',
      jobId: 'job-1',
      messagingSocketPath: sock,
      status: 'idle',
      updatedAt: 1,
    });
  });

  it('returns null for malformed or partial files', () => {
    expect(parseSessionEntry('{"pid": 1, "jobId"')).toBeNull();
    expect(parseSessionEntry('[]')).toBeNull();
    expect(parseSessionEntry(JSON.stringify({ jobId: 'job-1' }))).toBeNull();
    expect(parseSessionEntry(JSON.stringify(entry({ pid: 'x' })))).toBeNull();
  });

  it('keeps an entry with no job id or socket, as null fields', () => {
    const parsed = parseSessionEntry(
      JSON.stringify(entry({ jobId: undefined, messagingSocketPath: 5, status: undefined })),
    );
    expect(parsed).toMatchObject({ jobId: null, messagingSocketPath: null, status: null });
  });
});

describe('readLiveSessions', () => {
  it('maps each live session by its job id', () => {
    write(`${process.pid}.json`, entry());
    expect(readLiveSessions(dir).get('job-1')).toEqual({
      pid: process.pid,
      sessionId: 'sess-1',
      messagingSocketPath: sock,
      status: 'idle',
    });
  });

  it('skips entries whose process is gone, malformed files and the .key files', () => {
    write('999999.json', entry({ pid: 999_999, jobId: 'job-dead' }));
    write('1.json', '{"pid":');
    write(`${process.pid}.abc.key`, 'secret');
    write(`${process.pid}.json`, entry());
    expect([...readLiveSessions(dir).keys()]).toEqual(['job-1']);
  });

  it('reports no socket when the socket file is gone', () => {
    write(`${process.pid}.json`, entry({ messagingSocketPath: path.join(dir, 'gone.sock') }));
    expect(readLiveSessions(dir).get('job-1')?.messagingSocketPath).toBeNull();
  });

  it('prefers the most recently updated entry for a job', () => {
    write('a.json', entry({ updatedAt: 1, status: 'busy' }));
    write('b.json', entry({ updatedAt: 5, status: 'idle' }));
    expect(readLiveSessions(dir).get('job-1')?.status).toBe('idle');
  });

  it('is empty when there is no sessions folder', () => {
    expect(readLiveSessions(path.join(dir, 'nope')).size).toBe(0);
  });
});
