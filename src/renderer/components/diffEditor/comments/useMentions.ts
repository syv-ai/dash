import { useCallback, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import { nextSuggestion } from '../../ui/SuggestionMenu';
import { filterMentions, insertMention, mentionAt, type MentionQuery } from './mentions';

/**
 * @mention completion for a controlled textarea: what the menu lists, the
 * highlighted row, and the key handling (↑↓ move, ↵ or ⇥ pick, Esc closes)
 * the field runs before its own. Without candidates it is inert.
 */
export function useMentions({
  field,
  text,
  setText,
  candidates,
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText: (text: string) => void;
  candidates: readonly string[] | undefined;
}) {
  const [caret, setCaret] = useState(0);
  // The highlighted row, for the mention whose `@` is at `start`: a new
  // mention starts at the top of the list.
  const [pointer, setPointer] = useState({ start: -1, index: 0 });
  // The `@` the person closed the menu on: it stays shut until they type
  // another mention.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const query: MentionQuery | null = useMemo(
    () => (candidates?.length ? mentionAt(text, caret) : null),
    [candidates, text, caret],
  );
  const matches = useMemo(
    () => (query && candidates ? filterMentions(candidates, query.query) : []),
    [candidates, query],
  );
  const active = query && pointer.start === query.start ? pointer.index : 0;
  const setActive = useCallback(
    (index: number) => setPointer({ start: query?.start ?? -1, index }),
    [query],
  );
  const open = !!query && matches.length > 0 && dismissedAt !== query.start;

  /** Read the caret after an edit or a move. */
  const track = useCallback(() => {
    const el = field.current;
    if (el) setCaret(el.selectionStart ?? el.value.length);
  }, [field]);

  const pick = useCallback(
    (name: string) => {
      if (!query) return;
      const next = insertMention(text, query, caret, name);
      setText(next.text);
      setCaret(next.caret);
      // Put the caret after the name once React has written the value.
      requestAnimationFrame(() => {
        const el = field.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    },
    [query, text, caret, setText, field],
  );

  /** Run first in the field's keydown; true when the menu took the key. */
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open || e.metaKey || e.ctrlKey || e.altKey) return false;
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (step) {
        e.preventDefault();
        setActive(nextSuggestion(active, step, matches.length));
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[Math.min(active, matches.length - 1)]!);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedAt(query!.start);
        return true;
      }
      return false;
    },
    [open, matches, active, setActive, pick, query],
  );

  return {
    open,
    matches,
    active,
    setActive,
    pick,
    track,
    onKeyDown,
    dismiss: () => query && setDismissedAt(query.start),
  };
}
