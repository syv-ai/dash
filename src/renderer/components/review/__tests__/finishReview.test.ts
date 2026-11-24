import { describe, expect, it } from 'vitest';
import type { DiffComment } from '../../../../shared/types';
import {
  canPost,
  finishOffered,
  offeredVerdict,
  postLabel,
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
  author: 'user',
  kind: 'note',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('finishReview', () => {
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
});
