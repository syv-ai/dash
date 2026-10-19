import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DiffComment } from '../../../../shared/types';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import { registerReviewCapabilities, type ReviewCapabilityDeps } from '../review';
import type { AgentDraft } from '../../../services/diffCommentsRepo';

const asTask = (taskId: string) => ({ kind: 'task', taskId }) as const;

const tasks = [
  makeTask({ id: 'me', projectId: 'pA', dashAccess: true }),
  makeTask({ id: 'child', projectId: 'pA', parentTaskId: 'me' }),
  makeTask({ id: 'sibling', projectId: 'pA' }),
];

let registry: Registry;
let rows: Map<string, DiffComment>;
let changed: string[];

const row = (over: Partial<DiffComment> & { id: string }): DiffComment => ({
  taskId: 'me',
  filePath: 'src/a.ts',
  startLine: 3,
  endLine: 3,
  text: 'x',
  sent: false,
  viewScope: 'pr:github:12',
  side: 'RIGHT',
  replyTo: null,
  author: 'agent',
  createdAt: '',
  updatedAt: '',
  ...over,
});

beforeEach(() => {
  rows = new Map();
  changed = [];
  const deps: ReviewCapabilityDeps = {
    providerFor: () => 'github',
    getTask: (id) => tasks.find((t) => t.id === id),
    listPrDrafts: (taskId, provider, number) => {
      const mine = [...rows.values()].filter(
        (r) => r.taskId === taskId && r.viewScope === `pr:${provider}:${number}`,
      );
      return { comments: mine.filter((r) => !r.replyTo), replies: mine.filter((r) => r.replyTo) };
    },
    getDraft: (id) => rows.get(id),
    saveAgentDraft: vi.fn((d: AgentDraft) => {
      const saved = row({ ...d, author: rows.get(d.id)?.author ?? 'agent' });
      rows.set(d.id, saved);
      return saved;
    }),
    deleteDraft: (id) => void rows.delete(id),
    changed: (taskId) => void changed.push(taskId),
  };
  registry = createRegistry(fakeLookups([makeProject({ id: 'pA' })], tasks));
  registerReviewCapabilities(registry, deps);
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

describe('review.drafts_create', () => {
  it("drafts into the calling task's PR view, as the agent", async () => {
    const created = (await registry.call(asTask('me'), 'review.drafts_create', {
      number: 12,
      path: '/src/a.ts',
      startLine: 4,
      endLine: 6,
      body: 'Null here?',
    })) as { id: string };
    expect(rows.get(created.id)).toMatchObject({
      taskId: 'me',
      filePath: 'src/a.ts',
      startLine: 4,
      endLine: 6,
      text: 'Null here?',
      viewScope: 'pr:github:12',
      author: 'agent',
      replyTo: null,
    });
    expect(changed).toEqual(['me']);
  });

  it('reaches a child task, not a sibling', async () => {
    const input = { number: 12, path: 'a.ts', startLine: 1, body: 'b' };
    expect(
      await status(
        registry.call(asTask('me'), 'review.drafts_create', { ...input, taskId: 'child' }),
      ),
    ).toBe(200);
    expect(
      await status(
        registry.call(asTask('me'), 'review.drafts_create', { ...input, taskId: 'sibling' }),
      ),
    ).toBe(404);
  });

  it('refuses a range that ends before it starts, and the wrong provider', async () => {
    const input = { number: 12, path: 'a.ts', startLine: 5, body: 'b' };
    expect(
      await status(registry.call(asTask('me'), 'review.drafts_create', { ...input, endLine: 4 })),
    ).toBe(400);
    expect(
      await status(
        registry.call(asTask('me'), 'review.drafts_create', { ...input, provider: 'ado' }),
      ),
    ).toBe(400);
  });
});

describe('review.drafts_update / drafts_delete', () => {
  it("changes the agent's own draft", async () => {
    rows.set('d1', row({ id: 'd1' }));
    await registry.call(asTask('me'), 'review.drafts_update', {
      id: 'd1',
      body: 'better',
      endLine: 8,
    });
    expect(rows.get('d1')).toMatchObject({ text: 'better', startLine: 3, endLine: 8 });
    await registry.call(asTask('me'), 'review.drafts_delete', { id: 'd1' });
    expect(rows.has('d1')).toBe(false);
    expect(changed).toEqual(['me', 'me']);
  });

  it("leaves the user's drafts alone", async () => {
    rows.set('u1', row({ id: 'u1', author: 'user' }));
    expect(
      await status(registry.call(asTask('me'), 'review.drafts_update', { id: 'u1', body: 'mine' })),
    ).toBe(403);
    expect(await status(registry.call(asTask('me'), 'review.drafts_delete', { id: 'u1' }))).toBe(
      403,
    );
    expect(rows.get('u1')!.text).toBe('x');
  });

  it("can't see another task's draft, or a non-PR comment", async () => {
    rows.set('s1', row({ id: 's1', taskId: 'sibling' }));
    rows.set('l1', row({ id: 'l1', viewScope: 'live' }));
    expect(
      await status(registry.call(asTask('me'), 'review.drafts_update', { id: 's1', body: 'x' })),
    ).toBe(404);
    expect(await status(registry.call(asTask('me'), 'review.drafts_delete', { id: 'l1' }))).toBe(
      404,
    );
  });
});

describe('review.drafts_list', () => {
  it("lists the task's drafts for the PR, the user's and the agent's, by file and line", async () => {
    rows.set('b', row({ id: 'b', filePath: 'b.ts', author: 'user' }));
    rows.set('a2', row({ id: 'a2', filePath: 'a.ts', startLine: 9, replyTo: 'T1' }));
    rows.set('a1', row({ id: 'a1', filePath: 'a.ts', startLine: 2 }));
    rows.set('x', row({ id: 'x', viewScope: 'pr:github:13' }));
    const list = (await registry.call(asTask('me'), 'review.drafts_list', { number: 12 })) as {
      id: string;
    }[];
    expect(list.map((d) => d.id)).toEqual(['a1', 'a2', 'b']);
    expect(list[1]).toMatchObject({ replyTo: 'T1', body: 'x', author: 'agent' });
  });
});
