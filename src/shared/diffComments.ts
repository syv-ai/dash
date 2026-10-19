import type { DiffComment } from './types';

/** A draft reply to a PR thread, rather than a comment on lines. */
export const isReplyDraft = (c: Pick<DiffComment, 'replyTo'>): boolean => c.replyTo != null;
