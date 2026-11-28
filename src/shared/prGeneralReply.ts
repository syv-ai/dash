import type { ForgeCapabilities, PrReviewComment } from './types';

/** The general comment a reply answers: who wrote it and what. */
export type GeneralReplyTarget = Pick<PrReviewComment, 'id' | 'author' | 'body'>;

/** How many of the original's lines a quote keeps. */
const QUOTED_LINES = 3;

/**
 * A reply to a general PR comment where the forge doesn't thread them
 * (GitHub's PR conversation): a Markdown quote of the original's first lines
 * (blank and already-quoted lines left out, "…" when it goes on), then
 * `@author` and the reply. The mention isn't repeated when the reply already
 * opens with it, nor made for a deleted account ("ghost").
 */
export function quoteReply(to: Pick<GeneralReplyTarget, 'author' | 'body'>, text: string): string {
  const lines = to.body
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '' && !/^\s*>/.test(l));
  const quoted = [...lines.slice(0, QUOTED_LINES), ...(lines.length > QUOTED_LINES ? ['…'] : [])];
  const reply = text.trim();
  const mention = `@${to.author}`;
  const named =
    to.author === 'ghost' || reply.toLowerCase().startsWith(mention.toLowerCase())
      ? reply
      : `${mention} ${reply}`;
  return quoted.length > 0 ? `${quoted.map((l) => `> ${l}`).join('\n')}\n\n${named}` : named;
}

/** What a reply to a general comment posts as, by how the forge replies
 *  (`ForgeCapabilities.generalReply`): quoted where the conversation isn't
 *  threaded, the text itself where each general comment is a thread. */
export const generalReplyBody = (
  style: ForgeCapabilities['generalReply'],
  to: GeneralReplyTarget,
  text: string,
): string => (style === 'quote' ? quoteReply(to, text) : text.trim());
