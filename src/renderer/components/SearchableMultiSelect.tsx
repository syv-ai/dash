import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Loader2, Check, X } from 'lucide-react';
import type { IpcResponse } from '../../shared/types';

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
      }
    } catch {
      // Best effort
    } finally {
      setLoading(false);
    }
  }, [onSearch, results.length]);

  const search = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setLoading(true);
      const gen = ++searchGenRef.current;
      debounceRef.current = setTimeout(async () => {
        try {
          const resp = await onSearch(q);
          if (gen !== searchGenRef.current) return; // discard stale results
          if (resp.success && resp.data) {
            setResults(resp.data);
          }
        } catch {
          // Best effort
        } finally {
          if (gen === searchGenRef.current) setLoading(false);
        }
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
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              {getLabel(item)}
              <X size={9} strokeWidth={2.5} />
            </button>
          ))}
        </div>
      )}

      {/* Search input + dropdown */}
      <div className="relative" ref={dropdownRef}>
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-background border border-input/60 focus-within:ring-2 focus-within:ring-ring/30 focus-within:border-ring/50 transition-all duration-150">
          {loading ? (
            <Loader2 size={12} className="animate-spin text-muted-foreground/50 shrink-0" />
          ) : (
            <Search size={12} className="text-muted-foreground/40 shrink-0" />
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
              fetchRecent();
            }}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/30 outline-none"
          />
        </div>

        {dropdownOpen && (
          <div className="absolute z-50 mt-1 w-full bg-card border border-border/60 rounded-lg shadow-xl shadow-black/30 overflow-hidden">
            <div className="max-h-[200px] overflow-y-auto">
              {loading && results.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-muted-foreground/40 text-center flex items-center justify-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                  Searching...
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-muted-foreground/40 text-center">
                  No results found
                </div>
              ) : (
                results.map((item) => {
                  const key = getKey(item);
                  const isSelected = selected.some((s) => getKey(s) === key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggle(item)}
                      className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-accent/60 transition-colors duration-100 ${
                        isSelected ? 'bg-primary/5' : ''
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors duration-150 ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'border-border hover:border-foreground/40'
                        }`}
                      >
                        {isSelected && (
                          <Check size={10} strokeWidth={3} className="text-primary-foreground" />
                        )}
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
