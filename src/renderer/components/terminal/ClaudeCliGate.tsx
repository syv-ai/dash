import React, { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ClaudeCliInfo } from '../../../shared/types';
import { useRuntime } from '../../stores/runtimeStore';

/**
 * Replaces the task terminal when the Claude Code CLI is missing or older
 * than the floor Dash requires. Nothing is spawned behind it: MainContent
 * renders this instead of TerminalPane, and pty:startDirect refuses anyway.
 * Git panels, ports and shell drawers keep working around it.
 */
export function ClaudeCliGate({ info }: { info: ClaudeCliInfo }) {
  const [checking, setChecking] = useState(false);
  const command = info.installed ? 'claude update' : 'npm install -g @anthropic-ai/claude-code';

  async function recheck() {
    setChecking(true);
    try {
      await useRuntime.getState().refreshClaudeCli({ refresh: true });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="h-full flex items-center justify-center px-6">
      <div
        className="max-w-[440px] w-full rounded-xl border border-border/40 p-5 animate-fade-in"
        style={{ background: 'hsl(var(--surface-2))' }}
      >
        <div className="flex items-start gap-3.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[hsl(var(--git-modified)/0.12)] ring-1 ring-[hsl(var(--git-modified))/0.25]">
            <AlertTriangle
              size={15}
              className="text-[hsl(var(--git-modified))]"
              strokeWidth={1.8}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-foreground">
              {info.installed ? 'Claude Code needs an update' : 'Claude Code CLI not found'}
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed mt-1">
              {info.installed
                ? `Dash runs task sessions on Claude Code ${info.minVersion} or newer. This machine has ${info.version ?? 'an unknown version'}.`
                : `Dash runs task sessions through the Claude Code CLI (${info.minVersion} or newer).`}
            </p>
            <pre className="mt-3 px-3 py-2 rounded-lg bg-accent/80 text-xs font-mono text-fg-fade-80 overflow-x-auto">
              {command}
            </pre>
            {info.path && (
              <p className="text-xs text-fg-fade-40 font-mono truncate mt-2">{info.path}</p>
            )}
            <button
              onClick={() => void recheck()}
              disabled={checking}
              className="mt-3 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} strokeWidth={1.8} className={checking ? 'animate-spin' : ''} />
              Check again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
