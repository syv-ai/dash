import { describe, expect, it } from 'vitest';
import type { DiffComment, PrReviewThread, PrViewerReview } from '../../../../shared/types';
import {
  canPost,
  draftsLine,
  finishButton,
  finishOffered,
  ownReviewLine,
  pendingReviewLine,
  threadsLineShort,
  offeredVerdict,
  postLabel,
  postingItems,
  splitHeldBack,
  unsentNoteCount,
} from '../finishReview';

const draft = (id: string, over: Partial<DiffComment>): DiffComment => ({
  id,
  taskId: 't',
  filePath: 'a.ts',
  startLine: 1,
  endLine: 1,
  text: id,
  sent: false,
  viewScope: 'pr:github:7',
  side: 'RIGHT',
  replyTo: null,
  commit: null,
  author: 'user',
  kind: 'note',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('finishReview', () => {
  it('holds back line comments written on an older head, not replies or unknown ones', () => {
    const drafts = [
      draft('now', { kind: 'comment', commit: 'H2' }),
      draft('old', { kind: 'comment', commit: 'H1' }),
      draft('unknown', { kind: 'comment', commit: null }),
      draft('reply', { kind: 'comment', replyTo: 'T1' }),
    ];
    const { posting, heldBack } = splitHeldBack(drafts, 'H2');
    expect(posting.map((c) => c.id)).toEqual(['now', 'unknown', 'reply']);
    expect(heldBack.map((c) => c.id)).toEqual(['old']);
  });

  it('posts only when something would reach the PR', () => {
    expect(canPost({ comments: 0, summary: '  ', verdict: 'comment' })).toBe(false);
    expect(canPost({ comments: 1, summary: '', verdict: 'comment' })).toBe(true);
    expect(canPost({ comments: 0, summary: 'LGTM', verdict: 'comment' })).toBe(true);
    expect(canPost({ comments: 0, summary: '', verdict: 'approve' })).toBe(true);
  });

  it('names the forge, the count and a verdict beyond Comment on the button', () => {
    expect(postLabel('github', { comments: 5, summary: '', verdict: 'request_changes' })).toBe(
      'Post review to GitHub · 5 comments · Request changes',
    );
    expect(postLabel('ado', { comments: 1, summary: '', verdict: 'comment' })).toBe(
      'Post review to Azure DevOps · 1 comment',
    );
    expect(postLabel('github', { comments: 0, summary: '', verdict: 'approve' })).toBe(
      'Post review to GitHub · Approve',
    );
    expect(postLabel('github', { comments: 0, summary: 'LGTM', verdict: 'comment' })).toBe(
      'Post review to GitHub',
    );
  });

  it("counts only the PR's notes still to send as staying local", () => {
    const byFile = {
      'a.ts': [
        draft('open', {}),
        draft('sent', { sent: true }),
        draft('comment', { kind: 'comment' }),
        draft('elsewhere', { viewScope: 'live' }),
      ],
      'b.ts': [draft('also', { filePath: 'b.ts' })],
    };
    expect(unsentNoteCount(byFile, 'pr:github:7')).toBe(2);
    expect(unsentNoteCount(byFile, 'pr:github:8')).toBe(0);
  });

  it('falls back to Comment when the PR does not offer the picked verdict', () => {
    expect(offeredVerdict(['comment', 'approve'], 'approve')).toBe('approve');
    expect(offeredVerdict(['comment'], 'request_changes')).toBe('comment');
  });
});

describe('finishOffered', () => {
  const reply = draft('r', { kind: 'comment', replyTo: 'T1' });
  const line = draft('c', { kind: 'comment' });
  it("is always offered on someone else's PR", () => {
    expect(finishOffered({ own: false, comments: [], summary: '' })).toBe(true);
  });
  it('on the own PR, only with a line comment or a summary: replies post one by one', () => {
    expect(finishOffered({ own: true, comments: [reply], summary: ' ' })).toBe(false);
    expect(finishOffered({ own: true, comments: [reply, line], summary: '' })).toBe(true);
    expect(finishOffered({ own: true, comments: [], summary: 'LGTM' })).toBe(true);
  });

  it('lists what posts: threads with a draft reply and draft line comments, open first', () => {
    const thread = (id: string, over: Partial<PrReviewThread> = {}): PrReviewThread => ({
      id,
      path: 'a.ts',
      line: 3,
      startLine: null,
      side: 'RIGHT',
      isOutdated: false,
      resolved: false,
      comments: [],
      ...over,
    });
    const items = postingItems(
      [thread('quiet'), thread('open', { line: 9 }), thread('done', { resolved: true })],
      [
        draft('r1', { kind: 'comment', replyTo: 'done' }),
        draft('r2', { kind: 'comment', replyTo: 'open' }),
        draft('line', { kind: 'comment', startLine: 5, endLine: 5 }),
      ],
    );
    expect(items.map((i) => (i.kind === 'posted' ? i.thread.id : `draft:${i.draft.id}`))).toEqual([
      'draft:line',
      'open',
      'done',
    ]);
  });
});

describe('Finish review metadata', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');

  it("says what the person's last review was, when, and whether commits came after", () => {
    expect(ownReviewLine(null, now)).toBe('None');
    expect(
      ownReviewLine({ state: 'approved', at: '2026-11-27T09:00:00Z', stale: false }, now),
    ).toBe('Approved 3 hr ago');
    expect(ownReviewLine({ state: 'changes_requested', at: '', stale: true }, now)).toBe(
      'Changes requested · new commits since',
    );
  });

  it('counts the drafts as new threads and replies', () => {
    expect(draftsLine([])).toBe('None');
    expect(draftsLine([{ replyTo: null }])).toBe('1 new thread');
    expect(draftsLine([{ replyTo: null }, { replyTo: 'T' }, { replyTo: 'U' }])).toBe(
      '1 new thread, 2 replies',
    );
  });

  it("counts the PR's threads, open and resolved", () => {
    expect(threadsLineShort([])).toBe('None');
    expect(threadsLineShort([{ resolved: true }, { resolved: false }, { resolved: true }])).toBe(
      '1 open, 2 resolved',
    );
  });
});

describe('finishButton', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const approved: PrViewerReview = { state: 'approved', at: '2026-11-23T12:00:00Z', stale: false };
  const label = (drafts: number, summary: string, own: PrViewerReview | null) =>
    finishButton({ drafts, summary, own }, now).label;

  it('asks for a first review with nothing drafted', () => {
    expect(finishButton({ drafts: 0, summary: ' ', own: null }, now)).toEqual({
      label: 'Review…',
      title: null,
    });
  });

  it('leads with the drafts, the summary among them', () => {
    expect(label(2, 'LGTM', null)).toBe('3 drafts · Finish review…');
    expect(finishButton({ drafts: 1, summary: '', own: approved }, now)).toEqual({
      label: '1 draft · Finish review…',
      title: 'Your review: Approved 4 days ago',
    });
  });

  it('says what the last review was with nothing drafted', () => {
    expect(label(0, '', approved)).toBe('Approved · Review again…');
    expect(label(0, '', { ...approved, state: 'changes_requested' })).toBe(
      'Changes requested · Review again…',
    );
  });

  it('nudges a re-review once commits landed since it', () => {
    expect(
      finishButton({ drafts: 0, summary: '', own: { ...approved, stale: true } }, now),
    ).toEqual({
      label: 'Re-review new commits…',
      title: 'Your review: Approved 4 days ago · new commits since',
    });
  });
});

describe('pendingReviewLine', () => {
  it('counts the drafts as Finish review does, the summary among them, then the notes', () => {
    expect(pendingReviewLine({ drafts: 1, summary: 'LGTM', notes: 1 })).toBe('2 drafts · 1 note');
    expect(pendingReviewLine({ drafts: 0, summary: ' ', notes: 3 })).toBe('3 notes');
    expect(pendingReviewLine({ drafts: 1, summary: '', notes: 0 })).toBe('1 draft');
  });

  it('says nothing with nothing in hand', () => {
    expect(pendingReviewLine({ drafts: 0, summary: '', notes: 0 })).toBe('');
  });
});
