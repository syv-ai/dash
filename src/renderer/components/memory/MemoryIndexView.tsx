import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { MEMORY_INDEX_FILE } from '../../../shared/types';
import { MEMORY_HOOK_PLACEHOLDERS, MEMORY_INDEX_LIMIT, type ListedIndexRow } from './memoryView';

interface Props {
  /** MEMORY.md's lines (see memoryIndexRows), or null when the project has none. */
  rows: ListedIndexRow[] | null;
  /** The memory whose line is scrolled to and lit. */
  shown: string | null;
  onOpenMemory: (file: string) => void;
  /** What can be done with the file itself, shown beside its name. */
  actions: ReactNode;
}

/** What is off about a line, said beside it. */
function rowFlags({ row, missing }: ListedIndexRow): string[] {
  return [
    ...(missing.length > 0 ? [row.pointer ? 'file is gone' : `${missing.join(', ')} is gone`] : []),
    ...(row.files.length > 1 ? ['shared line'] : []),
    ...(row.files.length === 1 && !row.pointer ? ['not a pointer line'] : []),
  ];
}

/**
 * The modal's index view: MEMORY.md line by line, in the order Claude reads it,
 * with the cut past which it reads nothing. A line opens the memory it points at.
 */
export function MemoryIndexView({ rows, shown, onOpenMemory, actions }: Props) {
  const shownRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    shownRef.current?.scrollIntoView({ block: 'center' });
  }, [shown]);

  const note = (text: string) => (
    <div className="flex flex-1 items-center justify-center px-10 text-center text-[12px] text-muted-foreground">
      {text}
    </div>
  );
  if (!rows) {
    return note(
      `No ${MEMORY_INDEX_FILE} yet. Claude writes it with its first memory, and so does saving one here.`,
    );
  }

  // The first line for the shown memory takes the scroll; every line of it is lit.
  const scrollTo = rows.find((r) => shown !== null && r.row.files.includes(shown));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-5 py-2">
        <p className="min-w-0 text-[11px] text-muted-foreground">
          <span className="font-mono text-foreground">{MEMORY_INDEX_FILE}</span> as Claude reads it
          at the start of every session: one line per memory, in this order.
        </p>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>
      {rows.length === 0 &&
        note(`${MEMORY_INDEX_FILE} is empty: Claude recalls none of this project's memories.`)}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.map((listed) => {
          const { line, row, entries, firstPastCut } = listed;
          const lit = shown !== null && row.files.includes(shown);
          const flags = rowFlags(listed);
          const target = entries[0];
          const content = (
            <>
              <span className="w-7 shrink-0 text-right font-mono text-[10px] leading-[18px] text-fg-fade-35">
                {line}
              </span>
              <span className="min-w-0 flex-1">
                {row.pointer ? (
                  <>
                    <span className="block break-words text-[12px] text-foreground">
                      {row.pointer.title}
                    </span>
                    <span
                      className={`block text-[11px] ${row.pointer.hook ? 'text-muted-foreground' : 'text-fg-fade-35'}`}
                    >
                      {row.pointer.hook || MEMORY_HOOK_PLACEHOLDERS.own}
                    </span>
                  </>
                ) : (
                  <span
                    className={`block whitespace-pre-wrap break-words font-mono text-[11px] leading-[18px] ${
                      /^\s*#/.test(row.text)
                        ? 'font-semibold text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {row.text || ' '}
                  </span>
                )}
              </span>
              {(flags.length > 0 || row.pointer) && (
                <span className="max-w-[240px] shrink-0 truncate text-right text-[10px] leading-[18px] text-fg-fade-40">
                  {[...flags, ...(row.pointer ? row.files : [])].join(' · ')}
                </span>
              )}
            </>
          );
          const rowClass = 'flex w-full items-start gap-3 px-5 py-1 text-left';
          return (
            <div key={line}>
              {firstPastCut && (
                <div className="my-1 flex items-center gap-3 px-5 text-[10px] uppercase tracking-wide text-destructive">
                  <span className="h-px flex-1 bg-destructive/40" />
                  Claude stops reading here ({MEMORY_INDEX_LIMIT})
                  <span className="h-px flex-1 bg-destructive/40" />
                </div>
              )}
              {target ? (
                <button
                  type="button"
                  ref={listed === scrollTo ? shownRef : undefined}
                  onClick={() => onOpenMemory(target.file)}
                  title={`Open ${target.file}`}
                  aria-current={lit || undefined}
                  className={`${rowClass} transition-colors ${lit ? 'bg-accent' : 'hover:bg-accent/60'}`}
                >
                  {content}
                </button>
              ) : (
                <div className={rowClass}>{content}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
