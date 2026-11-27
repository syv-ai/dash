import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { SlashCommand } from '../../../shared/slashCommands';
import { nextSuggestion } from '../ui/SuggestionMenu';
import {
  filterSlashCommands,
  insertSlashCommand,
  slashCommandAt,
  type SlashQuery,
} from './slashCommandQuery';

/**
 * `/` completion for the context prompt: the project's slash commands and
 * skills (loaded once per project), what the menu lists, the highlighted row
 * and the keys (↑↓ move, ↵ or ⇥ pick, Esc closes) the field runs before its
 * own. Mirrors `useMentions`; without commands it is inert.
 */
export function useSlashCommands({
  field,
  projectPath,
  text,
  setText,
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  projectPath: string;
  text: string;
  setText: (text: string) => void;
}) {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.slashCommandsList({ projectPath }).then((resp) => {
      if (!cancelled && resp.success && resp.data) setCommands(resp.data);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const [caret, setCaret] = useState(0);
  // The highlighted row, for the command whose `/` is at `start`: a new one
  // starts at the top of the list.
  const [pointer, setPointer] = useState({ start: -1, index: 0 });
  // The `/` the person closed the menu on: it stays shut until they type another.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const query: SlashQuery | null = useMemo(
    () => (commands.length ? slashCommandAt(text, caret) : null),
    [commands, text, caret],
  );
  const matches = useMemo(
    () => (query ? filterSlashCommands(commands, query.query) : []),
    [commands, query],
  );
  const active = query && pointer.start === query.start ? pointer.index : 0;
  const setActive = useCallback(
    (index: number) => setPointer({ start: query?.start ?? -1, index }),
    [query],
  );
  // Once no command is being typed, a closed menu may open again (a new `/`
  // can sit where the dismissed one did, at the prompt's start).
  useEffect(() => {
    if (!query && dismissedAt !== null) setDismissedAt(null);
  }, [query, dismissedAt]);
  const open = !!query && matches.length > 0 && dismissedAt !== query.start;

  /** Read the caret after an edit or a move. */
  const track = useCallback(() => {
    const el = field.current;
    if (el) setCaret(el.selectionStart ?? el.value.length);
  }, [field]);

  const pick = useCallback(
    (name: string) => {
      if (!query) return;
      const next = insertSlashCommand(text, query, caret, name);
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
        pick(matches[Math.min(active, matches.length - 1)]!.name);
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
