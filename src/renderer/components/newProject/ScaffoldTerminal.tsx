import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';

interface ScaffoldTerminalProps {
  sessionId: string;
  methodId: string;
  url: string;
  parentDir: string;
  onExit: (exitCode: number, resultPath: string | null) => void;
}

export function ScaffoldTerminal({
  sessionId,
  methodId,
  url,
  parentDir,
  onExit,
}: ScaffoldTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'monospace',
      convertEol: true,
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const cols = term.cols;
    const rows = term.rows;

    const offData = window.electronAPI.onScaffoldData((p) => {
      if (p.sessionId === sessionId) term.write(p.data);
    });
    const offExit = window.electronAPI.onScaffoldExit((p) => {
      if (p.sessionId === sessionId) onExitRef.current(p.exitCode, p.resultPath);
    });
    const inputDisposable = term.onData((data) =>
      window.electronAPI.scaffoldInput({ sessionId, data }),
    );

    const onResize = () => {
      fit.fit();
      window.electronAPI.scaffoldResize({ sessionId, cols: term.cols, rows: term.rows });
    };
    window.addEventListener('resize', onResize);

    window.electronAPI.scaffoldStart({ sessionId, methodId, url, parentDir, cols, rows });

    return () => {
      window.removeEventListener('resize', onResize);
      inputDisposable.dispose();
      offData();
      offExit();
      window.electronAPI.scaffoldKill({ sessionId });
      term.dispose();
    };
    // Start exactly once per session; inputs come from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return <div ref={hostRef} className="h-[220px] w-full rounded-lg overflow-hidden bg-black/40" />;
}
