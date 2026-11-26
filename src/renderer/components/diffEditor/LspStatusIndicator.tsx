import { useEffect } from 'react';
import type { LspServerState, LspServerStatus } from '../../../shared/lsp';
import { refreshLspStatus } from '../../stores/lspStatusStore';
import { useLspHealth } from '../../lsp/healthWatch';
import { Dot, type DotTone } from '../ui/Dot';
import { Tooltip } from '../ui/Tooltip';

/** A server's dot (H4): it isn't an agent, so no agent colour; red only
 *  when it failed, a breathing neutral dot while it comes up. */
export const LSP_DOT: Record<LspServerState, { tone: DotTone; pulse: boolean }> = {
  starting: { tone: 'neutral', pulse: true },
  restarting: { tone: 'neutral', pulse: true },
  running: { tone: 'neutral', pulse: false },
  failed: { tone: 'fail', pulse: false },
  stopped: { tone: 'neutral', pulse: false },
  unavailable: { tone: 'neutral', pulse: false },
};

const NONE: LspServerStatus[] = [];

function describe(s: LspServerStatus): string {
  const source = s.source ? ` (${s.source})` : '';
  return `${s.name}: ${s.state}${source}${s.message ? `\n${s.message}` : ''}`;
}

/** The worktree's language servers that aren't healthy: a dot and short
 *  label each, the message and source in the tooltip. Nothing while all are
 *  running (or starting, briefly); the console has each transition. */
export function LspStatusIndicator({ worktree }: { worktree: string }) {
  const servers = useLspHealth((s) => s.unhealthy[worktree] ?? NONE);

  useEffect(() => {
    void refreshLspStatus(worktree);
  }, [worktree]);

  if (servers.length === 0) return null;
  return (
    <Tooltip content={servers.map(describe).join('\n')}>
      <span
        tabIndex={0}
        aria-label="Language servers not running"
        className="mx-1 inline-flex shrink-0 items-center gap-2 text-xs text-ink-3"
      >
        {servers.map((s) => (
          <span key={s.serverId} className="inline-flex items-center gap-1 whitespace-nowrap">
            <Dot {...LSP_DOT[s.state]} label={`${s.name} ${s.state}`} />
            <span className="@max-[28rem]/strip:hidden">
              {s.name} {s.state}
            </span>
          </span>
        ))}
      </span>
    </Tooltip>
  );
}
