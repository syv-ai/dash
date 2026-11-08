import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { ActivityInfo, Task } from '../../../../shared/types';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import type { LiveSession } from '../../../services/claudeSessionRegistry';
import { InboxWriteError, resetTaskInboxes, type TaskInbox } from '../../../services/taskInbox';
import { createReplyReader, registerTaskCapabilities, type TaskCapabilityDeps } from '../tasks';

const orch = { kind: 'orchestrator' } as const;
const asTask = (taskId: string) => ({ kind: 'task', taskId }) as const;
const SOCK = '/tmp/cc-socks/7.sock';
const TRANSCRIPT = '/cfg/projects/x/sess-1.jsonl';

let tasks: Task[];
let activity: Record<string, ActivityInfo>;
let untrusted: Record<string, string>;
let sessions: Map<string, LiveSession>;
let inboxes: Map<string, TaskInbox>;
let transcripts: Record<string, string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deps: Record<keyof TaskCapabilityDeps, Mock<(...args: any[]) => any>>;
let registry: Registry;

const live = (status = 'idle'): LiveSession => ({
  pid: 7,
  sessionId: 'sess-1',
  name: 't',
  messagingSocketPath: SOCK,
  status,
});
const inbox = (socket = SOCK): TaskInbox => ({ socket, token: 'tok', transcriptPath: TRANSCRIPT });
const task = (id: string) => tasks.find((t) => t.id === id)!;
/** The child task with a running session whose inbox Dash knows. */
function running(state: ActivityInfo['state'] = 'idle'): void {
  task('child').jobId = 'job-c';
  sessions.set('job-c', live());
  inboxes.set('child', inbox());
  activity = { child: { state } };
}

beforeEach(() => {
  const projects = [makeProject({ id: 'pA' })];
  tasks = [
    makeTask({ id: 'me', projectId: 'pA', dashAccess: true, name: 'Me' }),
    makeTask({ id: 'child', projectId: 'pA', parentTaskId: 'me', name: 'Child' }),
    makeTask({ id: 'old', projectId: 'pA', archivedAt: '2026-01-03T00:00:00.000Z' }),
  ];
  activity = {};
  untrusted = {};
  sessions = new Map();
  inboxes = new Map();
  transcripts = {};
  resetTaskInboxes();
  deps = {
    getProjects: vi.fn(() => projects),
    getTask: vi.fn((id: string) => tasks.find((t) => t.id === id)),
    getTasks: vi.fn((projectId: string) => tasks.filter((t) => t.projectId === projectId)),
    getActivity: vi.fn(() => activity),
    getUntrustedRoot: vi.fn((id: string) => untrusted[id]),
    getLiveSessions: vi.fn(() => sessions),
    onActivityChange: vi.fn(() => () => {}),
    onTasksChange: vi.fn(() => () => {}),
    recheckTrust: vi.fn(async (id: string) => !untrusted[id]),
    startSession: vi.fn(async () => ({ jobId: 'job-1' })),
    getInbox: vi.fn((id: string) => inboxes.get(id)),
    dropInbox: vi.fn((id: string) => inboxes.delete(id)),
    postToInbox: vi.fn(async () => {}),
    transcriptPathFor: vi.fn(() => null),
    readTranscript: vi.fn(async (file: string) => transcripts[file] ?? null),
  } as never;
  registry = createRegistry(fakeLookups(projects, tasks));
  registerTaskCapabilities(registry, deps as never);
});

afterEach(() => {
  vi.useRealTimers();
});

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    if (err instanceof ControlError) return err.status;
    throw err;
  }
}

const send = (
  over: Record<string, unknown> = {},
  caller: typeof orch | ReturnType<typeof asTask> = orch,
) =>
  registry.call(caller, 'tasks.message', {
    taskId: 'child',
    text: 'What is 17 + 25?',
    ...over,
  }) as Promise<{
    messageId: string;
    queued: boolean;
    task: { id: string; state: string };
  }>;

describe('tasks.message', () => {
  it('writes the header and body once to the known inbox', async () => {
    running();
    const result = await send();
    expect(result.messageId).toMatch(/^m_[0-9a-f]{8}$/);
    expect(result).toMatchObject({ queued: false, task: { id: 'child', state: 'idle' } });
    expect(deps.postToInbox).toHaveBeenCalledTimes(1);
    const [to, text] = deps.postToInbox.mock.calls[0]!;
    expect(to).toEqual(inbox());
    expect(text).toBe(
      `[Message from an orchestrator via Dash · id ${result.messageId} · your last message of this turn is read as the reply]\n\nWhat is 17 + 25?`,
    );
    expect(deps.startSession).not.toHaveBeenCalled();
  });

  it('names the sending task, or the given --from, and says when no reply is needed', async () => {
    running();
    await send({}, asTask('me'));
    expect(deps.postToInbox.mock.calls[0]![1]).toContain('[Message from task "Me" (me) via Dash');
    await send({ from: 'Holi', noReply: true });
    expect(deps.postToInbox.mock.calls[1]![1]).toMatch(
      /^\[Message from Holi via Dash · id m_\w+ · no reply needed\]/,
    );
    expect(await status(send({ from: 'two\nlines' }))).toBe(400);
  });

  it('is queued when the task is working', async () => {
    running('busy');
    expect(await send()).toMatchObject({ queued: true, task: { state: 'working' } });
  });

  it('refuses an archived task, one that needs trust, and the caller itself', async () => {
    expect(await status(send({ taskId: 'old' }))).toBe(409);
    untrusted = { child: '/repo' };
    expect(await status(send())).toBe(409);
    expect(await status(send({ taskId: 'me' }, asTask('me')))).toBe(403);
    expect(deps.startSession).not.toHaveBeenCalled();
    expect(deps.postToInbox).not.toHaveBeenCalled();
  });

  it('refuses a running session with no inbox known, naming the fix', async () => {
    vi.useFakeTimers();
    running();
    inboxes.clear();
    const pending = send();
    const settled = expect(pending).rejects.toMatchObject({
      status: 409,
      message:
        'no inbox known yet for Child: run `dashctl tasks restart child` (same conversation) and try again',
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await settled;
    expect(deps.postToInbox).not.toHaveBeenCalled();
  });

  it("drops an inbox whose socket is not the live session's", async () => {
    vi.useFakeTimers();
    running();
    inboxes.set('child', inbox('/tmp/cc-socks/old.sock'));
    const settled = expect(send()).rejects.toMatchObject({ status: 409 });
    await vi.advanceTimersByTimeAsync(5_000);
    await settled;
    expect(inboxes.has('child')).toBe(false);
  });

  it('starts a stopped session, waits for its inbox, then sends', async () => {
    vi.useFakeTimers();
    deps.startSession.mockImplementation(async (id: string) => {
      task(id).jobId = 'job-new';
      return { jobId: 'job-new' };
    });
    const pending = send();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.startSession).toHaveBeenCalledWith('child');
    sessions.set('job-new', live());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.postToInbox).not.toHaveBeenCalled();
    inboxes.set('child', inbox());
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ queued: false });
    expect(deps.postToInbox).toHaveBeenCalledTimes(1);
  });

  it('gives up after 30 s when the started session reports no inbox, sending nothing', async () => {
    vi.useFakeTimers();
    deps.startSession.mockImplementation(async (id: string) => {
      task(id).jobId = 'job-new';
      sessions.set('job-new', live());
      return { jobId: 'job-new' };
    });
    const settled = expect(send()).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(31_000);
    await settled;
    expect(deps.postToInbox).not.toHaveBeenCalled();
  });

  it('drops the inbox on a failed write and says whether it may have been delivered', async () => {
    running();
    deps.postToInbox.mockRejectedValueOnce(
      new InboxWriteError(
        'the session is no longer taking messages (its inbox socket is gone)',
        'no',
      ),
    );
    await expect(send()).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('nothing was sent'),
    });
    expect(inboxes.has('child')).toBe(false);
    running();
    deps.postToInbox.mockRejectedValueOnce(
      new InboxWriteError("the session's inbox did not answer in time", 'unknown'),
    );
    await expect(send()).rejects.toMatchObject({
      message: expect.stringContaining("don't send it again"),
    });
    expect(deps.postToInbox).toHaveBeenCalledTimes(2);
  });
});

const peerLine = (messageId: string) =>
  JSON.stringify({
    type: 'user',
    isMeta: true,
    origin: { kind: 'peer' },
    message: {
      content: `Another Claude session sent a message:\n[Message from an orchestrator via Dash · id ${messageId} · your last message of this turn is read as the reply]\n\nQ`,
    },
  });
const answerLine = (text: string, id = `a-${text}`) =>
  JSON.stringify({ type: 'assistant', message: { id, content: [{ type: 'text', text }] } });

describe('tasks.reply', () => {
  const reply = (messageId: string) =>
    registry.call(orch, 'tasks.reply', { taskId: 'child', messageId });

  it('is 404 for an id Dash does not know', async () => {
    await expect(reply('m_00000000')).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('kept in memory until Dash restarts'),
    });
  });

  it('is pending until the task answered and stopped working, then done', async () => {
    running('busy');
    const { messageId } = await send();
    expect(await reply(messageId)).toEqual({
      messageId,
      status: 'pending',
      queued: true,
      text: null,
    });

    transcripts[TRANSCRIPT] = [peerLine(messageId), answerLine('4')].join('\n');
    expect(await reply(messageId)).toMatchObject({ status: 'pending', text: '4' });

    transcripts[TRANSCRIPT] += '\n' + answerLine('42');
    activity = { child: { state: 'idle' } };
    expect(await reply(messageId)).toEqual({ messageId, status: 'done', queued: true, text: '42' });
  });

  it('falls back to the session transcript Dash locates when no hook named one', async () => {
    running();
    inboxes.set('child', { ...inbox(), transcriptPath: null });
    const { messageId } = await send();
    deps.transcriptPathFor.mockReturnValue('/elsewhere.jsonl');
    transcripts['/elsewhere.jsonl'] = [peerLine(messageId), answerLine('42')].join('\n');
    expect(await reply(messageId)).toMatchObject({ status: 'done', text: '42' });
  });

  it('is read-only and open to tasks', async () => {
    running();
    const { messageId } = await send({}, asTask('me'));
    expect(
      await status(registry.call(asTask('me'), 'tasks.reply', { taskId: 'child', messageId })),
    ).toBe(200);
  });
});

describe('pendingReplies', () => {
  it('returns each done reply once, leaving out noReply messages', async () => {
    running('busy');
    const a = await send();
    const b = await send({ noReply: true });
    const replies = createReplyReader(deps as never);
    const reported = new Set<string>();
    transcripts[TRANSCRIPT] = [peerLine(a.messageId), answerLine('42')].join('\n');
    expect(await replies.pendingReplies('child', reported)).toEqual([]); // still working
    activity = { child: { state: 'idle' } };
    expect(await replies.pendingReplies('child', reported)).toEqual([
      { messageId: a.messageId, queued: true, text: '42' },
    ]);
    expect(await replies.pendingReplies('child', reported)).toEqual([]);
    expect(b.messageId).not.toBe(a.messageId);
    // Another watch keeps its own record, so it gets the reply too.
    expect(await replies.pendingReplies('child', new Set())).toHaveLength(1);
  });
});

describe('tasks.watch reply lines', () => {
  it('emits a reply once when a messaged task stops working, not for older messages', async () => {
    running('busy');
    const old = await send();
    const listeners: Array<() => void> = [];
    deps.onActivityChange.mockImplementation((l: () => void) => {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    });
    const lines: Array<Record<string, unknown>> = [];
    const ac = new AbortController();
    const done = registry.call(
      orch,
      'tasks.watch',
      { taskId: 'child' },
      { emit: (l) => lines.push(l as Record<string, unknown>), signal: ac.signal },
    );
    const sent = await send();
    transcripts[TRANSCRIPT] = [
      peerLine(old.messageId),
      answerLine('old'),
      peerLine(sent.messageId),
      answerLine('42'),
    ].join('\n');
    const replies = () => lines.filter((l) => l.event === 'reply');
    for (const l of [...listeners]) l();
    await new Promise((r) => setTimeout(r, 0));
    expect(replies()).toEqual([]); // still working
    activity = { child: { state: 'idle' } };
    for (const l of [...listeners]) l();
    await new Promise((r) => setTimeout(r, 0));
    for (const l of [...listeners]) l();
    await new Promise((r) => setTimeout(r, 0));
    expect(replies()).toEqual([
      { event: 'reply', taskId: 'child', messageId: sent.messageId, queued: true, text: '42' },
    ]);
    ac.abort();
    await done;
    expect(listeners).toHaveLength(0);
  });
});
