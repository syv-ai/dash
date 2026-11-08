import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { RotateCw } from 'lucide-react';
import { useSetup } from '../../stores/setupStore';
import { followSetupLog } from '../../stores/setupLogFeed';
import { useSettings } from '../../stores/settingsStore';
import { resolveTheme } from '../../terminal/terminalThemes';
import { resolveTerminalFontValue } from '../../terminal/terminalFonts';
import { Button } from '../ui/Button';

/** Lines kept on screen; main caps the log at ~1 MB anyway. */
const SCROLLBACK = 20_000;

/**
 * The drawer's Setup tab: the worktree setup output in a read-only xterm (so
 * the script's colours survive), live while it runs, with "Run setup again".
 * No PTY behind it; the text comes from main's in-memory log.
 */
export function SetupLogPane({ taskId, worktreePath }: { taskId: string; worktreePath: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{ term: Terminal; refit: () => void } | null>(null);
  // The same settings App feeds the session registry, so the log follows
  // theme and font changes like the other terminals.
  const isDark = useSettings((s) => s.theme === 'dark');
  const terminalTheme = useSettings((s) => s.terminalTheme);
  const fontFamily = resolveTerminalFontValue(useSettings((s) => s.terminalFontFamily));
  const themeOf = (id: string, dark: boolean) => ({
    ...resolveTheme(id, dark),
    // Same glass as the drawer's shell tabs.
    background: 'rgba(0,0,0,0)',
  });
  const run = useSetup((s) => s.runs[worktreePath]);
  const rerun = useSetup((s) => s.rerun);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      // Pipe output ends lines with a bare \n.
      convertEol: true,
      scrollback: SCROLLBACK,
      fontSize: 13,
      fontFamily,
      lineHeight: 1.2,
      allowTransparency: true,
      theme: themeOf(terminalTheme, isDark),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    const refit = () => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        // Not laid out yet.
      }
    };
    const ro = new ResizeObserver(refit);
    ro.observe(host);
    refit();
    termRef.current = { term, refit };

    const hideCursor = '\x1b[?25l';
    const off = followSetupLog(worktreePath, {
      reset: (text, trimmed) => {
        term.reset();
        term.write(hideCursor);
        if (trimmed) term.write('\x1b[2m… earlier output trimmed\x1b[0m\n');
        term.write(text);
      },
      append: (chunk) => term.write(chunk),
    });
    return () => {
      termRef.current = null;
      off();
      ro.disconnect();
      term.dispose();
    };
    // Theme and font are applied live below, not by recreating the terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreePath]);

  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.term.options.theme = themeOf(terminalTheme, isDark);
  }, [terminalTheme, isDark]);

  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.term.options.fontFamily = fontFamily;
    t.refit();
  }, [fontFamily]);

  const running = run?.status === 'running';
  const status = running
    ? 'Running…'
    : run?.status === 'failed'
      ? `Failed: ${run.error ?? 'unknown error'}`
      : run?.status === 'succeeded'
        ? 'Finished'
        : '';
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 h-7 shrink-0">
        <span
          className={`text-[11px] truncate min-w-0 ${run?.status === 'failed' ? 'text-destructive' : 'text-muted-fade-60'}`}
        >
          {status}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0"
          disabled={running}
          onClick={() => void rerun({ id: taskId, path: worktreePath })}
        >
          <RotateCw size={12} strokeWidth={1.8} />
          Run setup again
        </Button>
      </div>
      <div ref={hostRef} className="terminal-drawer flex-1 min-h-0" />
    </div>
  );
}
