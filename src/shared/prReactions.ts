import type { PrReaction, PrReactionContent } from './types';

/** Every reaction, in the order a comment lists them: GitHub's eight in
 *  GitHub's order, then ADO's like. */
export const PR_REACTIONS = [
  'THUMBS_UP',
  'THUMBS_DOWN',
  'LAUGH',
  'HOORAY',
  'CONFUSED',
  'HEART',
  'ROCKET',
  'EYES',
  'LIKE',
] as const satisfies readonly PrReactionContent[];

/** GitHub's reactions, in the order GitHub lists them. */
export const GITHUB_REACTIONS: readonly PrReactionContent[] = PR_REACTIONS.filter(
  (c) => c !== 'LIKE',
);

/** What each reaction looks like, and its name (tooltip, accessible name). */
export const REACTIONS: Record<PrReactionContent, { emoji: string; name: string }> = {
  THUMBS_UP: { emoji: '👍', name: 'Thumbs up' },
  THUMBS_DOWN: { emoji: '👎', name: 'Thumbs down' },
  LAUGH: { emoji: '😄', name: 'Laugh' },
  HOORAY: { emoji: '🎉', name: 'Hooray' },
  CONFUSED: { emoji: '😕', name: 'Confused' },
  HEART: { emoji: '❤️', name: 'Heart' },
  ROCKET: { emoji: '🚀', name: 'Rocket' },
  EYES: { emoji: '👀', name: 'Eyes' },
  LIKE: { emoji: '👍', name: 'Like' },
};

const ORDER: readonly PrReactionContent[] = PR_REACTIONS;

/**
 * `reactions` with the viewer's `content` given (`on`) or taken back: its
 * count moves by one, a reaction no one gives any more drops out, and a new
 * one takes its place in the forge's order. Asking for what already holds
 * changes nothing.
 */
export function toggleReaction(
  reactions: readonly PrReaction[],
  content: PrReactionContent,
  on: boolean,
): PrReaction[] {
  const current = reactions.find((r) => r.content === content);
  if ((current?.viewerReacted ?? false) === on) return [...reactions];
  const count = Math.max(0, (current?.count ?? 0) + (on ? 1 : -1));
  const rest = reactions.filter((r) => r.content !== content);
  const next = count > 0 ? [...rest, { content, count, viewerReacted: on }] : rest;
  return next.sort((a, b) => ORDER.indexOf(a.content) - ORDER.indexOf(b.content));
}
