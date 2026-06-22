import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { SearchAddon, ISearchOptions } from '@xterm/addon-search';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface TerminalSearchProps {
  searchAddon: SearchAddon;
  onClose: () => void;
}

export function TerminalSearch({ searchAddon, onClose }: TerminalSearchProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<{ resultIndex: number; resultCount: number }>({
    resultIndex: -1,
    resultCount: 0,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus + select-all on mount so re-opening with a prior query lets
  // the user just start typing to overwrite.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const disp = searchAddon.onDidChangeResults((r) => setResults(r));
    return () => disp.dispose();
  }, [searchAddon]);

  const searchOptions: ISearchOptions = useMemo(
    () => ({
      caseSensitive,
      decorations: {
        matchBackground: '#515c6a',
        matchBorder: 'transparent',
        matchOverviewRuler: '#ffd33d',
        activeMatchBackground: '#515c6a',
        activeMatchBorder: '#ffd33d',
        activeMatchColorOverviewRuler: '#ffd33d',
      },
    }),
    [caseSensitive],
  );

  const findNext = useCallback(() => {
    if (query) searchAddon.findNext(query, searchOptions);
  }, [query, searchAddon, searchOptions]);

  const findPrev = useCallback(() => {
    if (query) searchAddon.findPrevious(query, searchOptions);
  }, [query, searchAddon, searchOptions]);

  const handleClose = useCallback(() => {
    searchAddon.clearDecorations();
    onClose();
  }, [searchAddon, onClose]);

  // Live update on query/case-sensitivity changes.
  useEffect(() => {
    if (query) searchAddon.findNext(query, searchOptions);
    else searchAddon.clearDecorations();
  }, [query, searchOptions, searchAddon]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) findPrev();
      else findNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
  };

  const counter =
    !query || results.resultCount === 0
      ? query
        ? 'No results'
        : ''
      : `${results.resultIndex + 1}/${results.resultCount}`;

  return (
    <div className="absolute top-1 right-1 z-20 flex items-center gap-1 pl-2 pr-1 py-1 rounded-md bg-[hsl(var(--surface-1)/0.95)] border border-input/40 backdrop-blur shadow-md">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find"
        className="w-44 px-1 py-0.5 text-[12px] bg-transparent text-foreground placeholder:text-muted-foreground/40 outline-none"
      />
      <span className="text-[10px] text-muted-foreground/70 font-mono min-w-[56px] text-right select-none">
        {counter}
      </span>
      <button
        type="button"
        onClick={() => setCaseSensitive((v) => !v)}
        className={`px-1.5 py-0.5 text-[11px] font-mono rounded transition-colors ${
          caseSensitive
            ? 'bg-primary/20 text-foreground'
            : 'text-muted-foreground/70 hover:text-foreground'
        }`}
        title="Match case"
      >
        Aa
      </button>
      <button
        type="button"
        onClick={findPrev}
        className="p-1 text-muted-foreground/80 hover:text-foreground transition-colors"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={findNext}
        className="p-1 text-muted-foreground/80 hover:text-foreground transition-colors"
        title="Next match (Enter)"
      >
        <ChevronDown size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={handleClose}
        className="p-1 text-muted-foreground/80 hover:text-foreground transition-colors"
        title="Close (Esc)"
      >
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
