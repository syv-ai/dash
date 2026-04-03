import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { sessionRegistry } from '../terminal/SessionRegistry';
import { resolveTheme } from '../terminal/terminalThemes';
import {
  CURATED_FONTS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_DEFAULT,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_DEFAULT,
  LINE_HEIGHT_STEP,
} from '../terminal/terminalFonts';

interface TerminalFontSettingsProps {
  terminalTheme: string;
  theme: 'light' | 'dark';
}

export function TerminalFontSettings({ terminalTheme, theme }: TerminalFontSettingsProps) {
  const [fontFamily, setFontFamily] = useState<string | null>(() => {
    return localStorage.getItem('terminalFontFamily') || null;
  });
  const [fontSize, setFontSize] = useState(() => {
    const stored = localStorage.getItem('terminalFontSize');
    return stored ? parseInt(stored, 10) : FONT_SIZE_DEFAULT;
  });
  const [lineHeight, setLineHeight] = useState(() => {
    const stored = localStorage.getItem('terminalLineHeight');
    return stored ? parseFloat(stored) : LINE_HEIGHT_DEFAULT;
  });

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Propagate font changes to all terminals
  useEffect(() => {
    sessionRegistry.setAllTerminalFont(fontFamily, fontSize, lineHeight);
  }, [fontFamily, fontSize, lineHeight]);

  // Load system fonts when dropdown opens
  useEffect(() => {
    if (dropdownOpen && systemFonts.length === 0) {
      window.electronAPI
        .getSystemFonts()
        .then((resp) => {
          if (resp.success && resp.data && resp.data.length > 0) {
            setSystemFonts(resp.data);
          }
        })
        .catch(() => {});
    }
  }, [dropdownOpen, systemFonts.length]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const updateFontFamily = (f: string | null) => {
    setFontFamily(f);
    if (f) {
      localStorage.setItem('terminalFontFamily', f);
    } else {
      localStorage.removeItem('terminalFontFamily');
    }
  };

  const updateFontSize = (s: number) => {
    setFontSize(s);
    localStorage.setItem('terminalFontSize', String(s));
  };

  const updateLineHeight = (h: number) => {
    setLineHeight(h);
    localStorage.setItem('terminalLineHeight', String(h));
  };

  const curatedNames = new Set(CURATED_FONTS.map((c) => c.name.toLowerCase()));
  const filteredSystemFonts = systemFonts.filter(
    (f) => f.toLowerCase().includes(search.toLowerCase()) && !curatedNames.has(f.toLowerCase()),
  );

  const currentTheme = resolveTheme(terminalTheme, theme === 'dark');

  return (
    <div>
      <label className="block text-[12px] font-medium text-foreground mb-3">Terminal Font</label>

      {/* Font Family Picker */}
      <div className="mb-4">
        <div className="text-[11px] text-muted-foreground mb-1.5">Font Family</div>
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border/60 text-[13px] text-foreground hover:border-border transition-colors"
            style={{ background: 'hsl(var(--surface-0))' }}
          >
            <span style={{ fontFamily: fontFamily || 'monospace' }}>
              {fontFamily
                ? CURATED_FONTS.find((f) => f.family === fontFamily)?.name ||
                  fontFamily.split(',')[0].replace(/'/g, '').trim()
                : 'Default (monospace)'}
            </span>
            <ChevronDown size={14} strokeWidth={1.8} className="text-muted-foreground" />
          </button>

          {dropdownOpen && (
            <div
              className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-border/60 shadow-lg max-h-[280px] overflow-hidden flex flex-col"
              style={{ background: 'hsl(var(--surface-1))' }}
            >
              {/* Search */}
              <div className="p-2 border-b border-border/40">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search fonts..."
                  className="w-full px-2.5 py-1.5 rounded-md border border-border/60 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
                  style={{ background: 'hsl(var(--surface-0))' }}
                  autoFocus
                />
              </div>

              <div className="overflow-y-auto flex-1">
                {/* Default option */}
                <button
                  onClick={() => {
                    updateFontFamily(null);
                    setDropdownOpen(false);
                    setSearch('');
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                    fontFamily === null ? 'text-primary' : 'text-foreground/80'
                  }`}
                  style={{ ['--tw-bg-opacity' as string]: 1 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'hsl(var(--surface-2))')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  Default (monospace)
                  {fontFamily === null && (
                    <Check size={12} strokeWidth={2} className="float-right text-primary mt-0.5" />
                  )}
                </button>

                {/* Curated fonts */}
                <div className="px-3 pt-2 pb-1 text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                  Popular
                </div>
                {CURATED_FONTS.filter((f) =>
                  f.name.toLowerCase().includes(search.toLowerCase()),
                ).map((f) => (
                  <button
                    key={f.family}
                    onClick={() => {
                      updateFontFamily(f.family);
                      setDropdownOpen(false);
                      setSearch('');
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                      fontFamily === f.family ? 'text-primary' : 'text-foreground/80'
                    }`}
                    style={{ fontFamily: f.family }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'hsl(var(--surface-2))')
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    {f.name}
                    {fontFamily === f.family && (
                      <Check
                        size={12}
                        strokeWidth={2}
                        className="float-right text-primary mt-0.5"
                      />
                    )}
                  </button>
                ))}

                {/* System fonts — flat list, deduped against curated */}
                {filteredSystemFonts.length > 0 && (
                  <>
                    <div className="px-3 pt-2 pb-1 text-[10px] text-muted-foreground/60 uppercase tracking-wider border-t border-border/40 mt-1">
                      System
                    </div>
                    {filteredSystemFonts.map((f) => {
                      const family = `'${f}', monospace`;
                      return (
                        <button
                          key={f}
                          onClick={() => {
                            updateFontFamily(family);
                            setDropdownOpen(false);
                            setSearch('');
                          }}
                          className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                            fontFamily === family ? 'text-primary' : 'text-foreground/80'
                          }`}
                          style={{ fontFamily: family }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = 'hsl(var(--surface-2))')
                          }
                          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                        >
                          {f}
                          {fontFamily === family && (
                            <Check
                              size={12}
                              strokeWidth={2}
                              className="float-right text-primary mt-0.5"
                            />
                          )}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Font Size */}
      <div className="mb-4">
        <div className="text-[11px] text-muted-foreground mb-1.5">Font Size</div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={fontSize}
            onChange={(e) => updateFontSize(parseInt(e.target.value, 10))}
            className="flex-1 accent-primary"
          />
          <input
            type="number"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={fontSize}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (v >= FONT_SIZE_MIN && v <= FONT_SIZE_MAX) {
                updateFontSize(v);
              }
            }}
            className="w-[50px] text-center px-1.5 py-1 rounded-md border border-border/60 text-[13px] text-foreground focus:outline-none focus:border-primary/40"
            style={{ background: 'hsl(var(--surface-0))' }}
          />
          <span className="text-[11px] text-muted-foreground">px</span>
        </div>
      </div>

      {/* Line Height */}
      <div className="mb-4">
        <div className="text-[11px] text-muted-foreground mb-1.5">Line Height</div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step={LINE_HEIGHT_STEP}
            value={lineHeight}
            onChange={(e) => updateLineHeight(parseFloat(e.target.value))}
            className="flex-1 accent-primary"
          />
          <input
            type="number"
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step={LINE_HEIGHT_STEP}
            value={lineHeight}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (v >= LINE_HEIGHT_MIN && v <= LINE_HEIGHT_MAX) {
                updateLineHeight(v);
              }
            }}
            className="w-[50px] text-center px-1.5 py-1 rounded-md border border-border/60 text-[13px] text-foreground focus:outline-none focus:border-primary/40"
            style={{ background: 'hsl(var(--surface-0))' }}
          />
        </div>
      </div>

      {/* Live Preview */}
      <div
        className="rounded-lg border border-border/60 p-3 overflow-hidden"
        style={{ backgroundColor: currentTheme.background }}
      >
        <div className="text-[10px] uppercase tracking-wider mb-2 opacity-40 font-sans text-foreground">
          Preview
        </div>
        <div
          style={{
            fontFamily: fontFamily || 'monospace',
            fontSize: `${fontSize}px`,
            lineHeight: lineHeight,
            color: currentTheme.foreground,
          }}
        >
          <div>
            <span style={{ color: currentTheme.magenta }}>const</span>{' '}
            <span style={{ color: currentTheme.yellow }}>greeting</span> ={' '}
            <span style={{ color: currentTheme.green }}>&apos;Hello, World!&apos;</span>;
          </div>
          <div style={{ color: currentTheme.brightBlack }}>{'// 0O oO ilIL1| {} [] () <>'}</div>
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground/50 mt-1.5">
        Applies to all Claude and shell terminals
      </div>
    </div>
  );
}
