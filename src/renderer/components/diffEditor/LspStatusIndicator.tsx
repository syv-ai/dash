import { useEffect } from 'react';
import type { LspServerState, LspServerStatus } from '../../../shared/lsp';
import { refreshLspStatus, useLspStatus } from '../../stores/lspStatusStore';
import { StatusDot, type AgentState } from '../ui/StatusDot';
import { Tooltip } from '../ui/Tooltip';

const DOT: Record<LspServerState, AgentState> = {
  starting: 'work',
  restarting: 'work',
  running: 'done',
  failed: 'fail',
  stopped: 'idle',
  unavailable: 'idle',
};

const NONE: LspServerStatus[] = [];

function describe(s: LspServerStatus): string {
  const source = s.source ? ` (${s.source})` : '';
  return `${s.name}: ${s.state}${source}${s.message ? `\n${s.message}` : ''}`;
}

/** The language servers running for a worktree: a dot and name each, the
 *  state and any message in the tooltip. Nothing while none has started. */
export function LspStatusIndicator({ worktree }: { worktree: string }) {
  const servers = useLspStatus((s) => s.byWorktree[worktree] ?? NONE);

  useEffect(() => {
    void refreshLspStatus(worktree);
  }, [worktree]);

  if (servers.length === 0) return null;
  return (
    <Tooltip content={servers.map(describe).join('\n')}>
      <span
        tabIndex={0}
        aria-label="Language servers"
        className="mx-1 inline-flex shrink-0 items-center gap-2 text-xs text-muted-fade-60"
      >
        {servers.map((s) => (
          <span key={s.serverId} className="inline-flex items-center gap-1 whitespace-nowrap">
            <StatusDot state={DOT[s.state]} label={`${s.name} ${s.state}`} />
            <span className="@max-[360px]/strip:hidden">{s.name}</span>
          </span>
        ))}
      </span>
    </Tooltip>
  );
}
