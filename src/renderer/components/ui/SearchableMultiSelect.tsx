import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Loader2, Check, X } from 'lucide-react';
import type { IpcResponse } from '../../../shared/types';

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

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    <>
      {/* Selected item pills */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selected.map((item) => (
            <button
              key={getKey(item)}
              type="button"
              onClick={() => remove(getKey(item))}
              className="inline-flex h-5 items-center gap-1 rounded-sm bg-hover px-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-state-fail/12 hover:text-state-fail"
            >
              {getLabel(item)}
              <X size={9} strokeWidth={2.5} />
            </button>
          ))}
        </div>
      )}

      {/* Search input + dropdown */}
      <div className="relative" ref={dropdownRef}>
        <div className="flex h-7.5 items-center gap-2 rounded-md bg-hover px-2.5 transition-colors hover:bg-select focus-within:bg-well focus-within:ring-1 focus-within:ring-line">
          {loading ? (
            <Loader2 size={14} strokeWidth={1.8} className="animate-spin text-icon shrink-0" />
          ) : (
            <Search size={14} strokeWidth={1.8} className="text-icon shrink-0" />
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
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 outline-none"
          />
        </div>

        {dropdownOpen && (
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg bg-raised p-1.5 shadow-raised">
            <div className="max-h-[200px] overflow-y-auto">
              {loading && results.length === 0 ? (
                <div className="px-3 py-3 text-sm text-ink-3 text-center flex items-center justify-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                  Searching...
                </div>
              ) : error && results.length === 0 ? (
                <div className="px-3 py-3 text-sm text-state-fail text-center break-words">
                  {error}
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 text-sm text-ink-3 text-center">No results found</div>
              ) : (
                results.map((item) => {
                  const key = getKey(item);
                  const isSelected = selected.some((s) => getKey(s) === key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggle(item)}
                      className={`flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-100 hover:bg-hover ${
                        isSelected ? 'bg-select' : ''
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors duration-150 ${
                          isSelected ? 'border-btn bg-btn' : 'border-ink-3 hover:border-ink-2'
                        }`}
                      >
                        {isSelected && <Check size={10} strokeWidth={3} className="text-btn-ink" />}
                      </span>
                      <div className="flex-1 min-w-0">{renderItem(item)}</div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
