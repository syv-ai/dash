import type { DiffComment } from './types';

/** A draft reply to a PR thread, rather than a comment on lines. */
export const isReplyDraft = (c: Pick<DiffComment, 'replyTo'>): boolean => c.replyTo != null;

/** A PR review comment (a draft until Submit), rather than a note for the agent. */
export const isPrComment = (c: Pick<DiffComment, 'kind'>): boolean => c.kind === 'comment';
