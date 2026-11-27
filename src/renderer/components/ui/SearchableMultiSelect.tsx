import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import type { IpcResponse } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { badgeVariants } from './Badge';
import { CheckboxMark } from './Checkbox';
import { Popover, PopoverAnchor, PopoverContent } from './Popover';
import { focusRing } from './styles';

interface SearchableMultiSelectProps<T> {
  /** Perform a search and return results via IpcResponse */
  onSearch: (query: string) => Promise<IpcResponse<T[]>>;
  /** Currently selected items */
  selected: T[];
  /** Called when selection changes */
  onSelect: (items: T[]) => void;
  /** Unique key for each item */
  getKey: (item: T) => string | number;
  /** Short label for selected item pills */
  getLabel: (item: T) => string;
  /** Render a single item row in the dropdown */
  renderItem: (item: T) => React.ReactNode;
  /** Input placeholder */
  placeholder: string;
}

export function SearchableMultiSelect<T>({
  onSearch,
  selected,
  onSelect,
  getKey,
  getLabel,
  renderItem,
  placeholder,
}: SearchableMultiSelectProps<T>) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // When a search fails (e.g. ADO auth/404/timeout), show the real reason rather
  // than a misleading "No results found" empty state.
  const [error, setError] = useState<string | null>(null);

  const anchorRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      searchInputRef.current?.focus();
    }
  }, [dropdownOpen]);

  const fetchRecent = useCallback(async () => {
    if (results.length > 0) return;
    setLoading(true);
    try {
      const resp = await onSearch('');
      if (resp.success && resp.data) {
        setResults(resp.data);
        setError(null);
      } else {
        setError(resp.error || 'Search failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onSearch, results.length]);

  const search = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setLoading(true);
      const gen = ++searchGenRef.current;
      debounceRef.current = setTimeout(() => {
        void (async () => {
          try {
            const resp = await onSearch(q);
            if (gen !== searchGenRef.current) return; // discard stale results
            if (resp.success && resp.data) {
              setResults(resp.data);
              setError(null);
            } else {
              setError(resp.error || 'Search failed');
            }
          } catch (err) {
            if (gen !== searchGenRef.current) return;
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            if (gen === searchGenRef.current) setLoading(false);
          }
        })();
      }, 400);
    },
    [onSearch],
  );

  function toggle(item: T) {
    const key = getKey(item);
    const exists = selected.some((s) => getKey(s) === key);
    if (exists) {
      onSelect(selected.filter((s) => getKey(s) !== key));
    } else {
      onSelect([...selected, item]);
    }
  }

  function remove(key: string | number) {
    onSelect(selected.filter((s) => getKey(s) !== key));
  }

  return (
    <div className="grid gap-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((item) => (
            <button
              key={getKey(item)}
              type="button"
              title="Remove"
              onClick={() => remove(getKey(item))}
              className={cn(
                badgeVariants({ size: 'sm' }),
                'text-ink-2 transition-colors hover:bg-state-fail/12 hover:text-state-fail',
                focusRing,
              )}
            >
              {getLabel(item)}
              <X size={14} strokeWidth={1.8} />
            </button>
          ))}
        </div>
      )}

      {/* The list floats in a portal, so it never stretches or clips the
          dialog body it sits in, and that body keeps scrolling. */}
      <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <PopoverAnchor asChild>
          <div
            ref={anchorRef}
            className="flex h-7.5 items-center gap-2 rounded-md bg-hover px-2.5 transition-colors focus-within:bg-well focus-within:ring-1 focus-within:ring-line hover:bg-select"
          >
            {loading ? (
              <Loader2 size={14} strokeWidth={1.8} className="shrink-0 animate-spin text-icon" />
            ) : (
              <Search size={14} strokeWidth={1.8} className="shrink-0 text-icon" />
            )}
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                search(e.target.value);
                setDropdownOpen(true);
              }}
              onFocus={() => {
                setDropdownOpen(true);
                void fetchRecent();
              }}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          sideOffset={4}
          className="w-(--radix-popper-anchor-width) p-1.5"
          // Typing stays in the field; a click on the field isn't "outside".
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
        >
          <div className="scrollbar-thin-hover max-h-60 overflow-y-auto">
            {loading && results.length === 0 ? (
              <p className="type-caption flex items-center justify-center gap-2 py-3">
                <Loader2 size={14} strokeWidth={1.8} className="animate-spin text-icon" />
                Searching…
              </p>
            ) : error && results.length === 0 ? (
              <p className="type-caption px-2.5 py-3 text-center break-words text-state-fail">
                {error}
              </p>
            ) : results.length === 0 ? (
              <p className="type-caption py-3 text-center">No results</p>
            ) : (
              results.map((item) => {
                const key = getKey(item);
                const isSelected = selected.some((s) => getKey(s) === key);
                return (
                  <button
                    key={key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isSelected}
                    onClick={() => toggle(item)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-hover aria-checked:bg-select',
                      focusRing,
                    )}
                  >
                    <CheckboxMark checked={isSelected} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">{renderItem(item)}</div>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
