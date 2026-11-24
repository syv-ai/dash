import { describe, expect, it } from 'vitest';
import { canPost, offeredVerdict, postLabel } from '../finishReview';

describe('finishReview', () => {
  it('posts only when something would reach the PR', () => {
    expect(canPost({ comments: 0, summary: '  ', verdict: 'comment' })).toBe(false);
    expect(canPost({ comments: 1, summary: '', verdict: 'comment' })).toBe(true);
    expect(canPost({ comments: 0, summary: 'LGTM', verdict: 'comment' })).toBe(true);
    expect(canPost({ comments: 0, summary: '', verdict: 'approve' })).toBe(true);
  });

  it('names the forge, the count and the verdict on the button', () => {
    expect(postLabel('github', { comments: 5, summary: '', verdict: 'request_changes' })).toBe(
      'Post review to GitHub (5 comments · Request changes)',
    );
    expect(postLabel('ado', { comments: 1, summary: '', verdict: 'comment' })).toBe(
      'Post review to Azure DevOps (1 comment · Comment)',
    );
    expect(postLabel('github', { comments: 0, summary: '', verdict: 'approve' })).toBe(
      'Post review to GitHub (Approve)',
    );
  });

  it('falls back to Comment when the PR does not offer the picked verdict', () => {
    expect(offeredVerdict(['comment', 'approve'], 'approve')).toBe('approve');
    expect(offeredVerdict(['comment'], 'request_changes')).toBe('comment');
  });
});
