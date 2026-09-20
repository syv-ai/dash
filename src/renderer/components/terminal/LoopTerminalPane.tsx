import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Repeat, Compass, Play, Pause, Square, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import type { LoopRunState } from '../../../shared/types';
import { useRuntime } from '../../stores/runtimeStore';
import { Button } from '../ui/Button';
import { TerminalPane } from './TerminalPane';

interface LoopTerminalPaneProps {
  taskId: string;
  cwd: string;
  terminalBg?: string;
}

/** States in which the loop is live (has a scheduler) rather than finished/idle. */
const ACTIVE_STATES: ReadonlySet<LoopRunState> = new Set(['running', 'paused']);

/**
 * Start / Pause / Resume / Stop + a live status readout, driven by the
 * LoopController via `loop:status`. The buttons are the human control points on
 * Dash's iteration `while`; the scheduler and manager MCP share the same ops.
 */
function LoopControlBar({ taskId }: { taskId: string }) {
  const status = useRuntime((s) => s.loopStatuses[taskId]);
  const state: LoopRunState = status?.state ?? 'idle';
  const isActive = ACTIVE_STATES.has(state);

  const run = (op: () => Promise<{ success: boolean; error?: string }>) => () => {
    void op().then((resp) => {
      if (!resp.success) toast.error(resp.error ?? 'Loop action failed');
    });
  };

  const stateColor =
    state === 'running'
      ? 'text-[hsl(var(--git-added))]'
      : state === 'paused'
        ? 'text-[hsl(var(--git-modified))]'
        : state === 'error'
          ? 'text-destructive'
          : 'text-muted-foreground';

  const iterLabel = status
    ? `iter ${status.iteration}${status.maxIterations ? `/${status.maxIterations}` : ''}`
    : null;
  const tokenLabel =
    status && status.tokenBudget
      ? `${status.tokensSpent.toLocaleString()}/${status.tokenBudget.toLocaleString()} tok`
      : status && status.tokensSpent > 0
        ? `${status.tokensSpent.toLocaleString()} tok`
        : null;

  return (
    <div className="flex items-center gap-3 px-3 h-[34px] shrink-0 border-b border-border/40">
      <div className="flex items-center gap-2 min-w-0 text-[11px]">
        <span className={`font-medium capitalize ${stateColor}`}>{state}</span>
        {iterLabel && <span className="text-muted-foreground">· {iterLabel}</span>}
        {tokenLabel && <span className="text-muted-foreground">· {tokenLabel}</span>}
        {status?.reason && (
          <span className="text-muted-foreground/70 truncate italic">· {status.reason}</span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {!isActive && (
          <Button
            size="sm"
            variant="primary"
            onClick={run(() => window.electronAPI.loopStart(taskId))}
          >
            <Play size={13} strokeWidth={1.8} />
            Start
          </Button>
        )}
        {state === 'running' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={run(() => window.electronAPI.loopPause(taskId))}
          >
            <Pause size={13} strokeWidth={1.8} />
            Pause
          </Button>
        )}
        {state === 'paused' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={run(() => window.electronAPI.loopResume(taskId))}
          >
            <RotateCw size={13} strokeWidth={1.8} />
            Resume
          </Button>
        )}
        {isActive && (
          <Button
            size="sm"
            variant="secondary"
            onClick={run(() => window.electronAPI.loopStop(taskId))}
          >
            <Square size={13} strokeWidth={1.8} />
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The two-terminal main pane for an agentic loop (see docs/agentic-loops-plan.md).
 * Left = the Ralph WORKER (fresh context each iteration, acts), right = the
 * persistent MANAGER (orchestrates, never edits code).
 *
 * Both panes are `managedExternally`: main's LoopController owns spawning and the
 * Ralph reset cadence (worker fresh-context each pass, manager persistent). The
 * renderer only declares which role each terminal hosts (`loopRole`) and attaches
 * xterm to the PTY id — it never spawns, so it can't race the controller. Main
 * owns all per-role policy — model, permission, the seed prompt, and the manager's
 * write-deny settings — derived from the task's LoopConfig (see loopSpawn.ts). The
 * PTY ids (`loop:<taskId>` / `mgr:<taskId>`) are what the LoopScheduler and MCP
 * bridge target.
 */
export function LoopTerminalPane({ taskId, cwd, terminalBg }: LoopTerminalPaneProps) {
  return (
    <div className="flex h-full w-full flex-col">
      <LoopControlBar taskId={taskId} />
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal" className="h-full w-full" autoSaveId={`loop:${taskId}`}>
          <Panel id="loop-worker" order={1} minSize={25} defaultSize={50}>
            <LoopColumn
              icon={<Repeat size={13} strokeWidth={1.8} />}
              label="Worker"
              sub="iterates · acts"
            >
              <TerminalPane
                key={`loop:${taskId}`}
                id={`loop:${taskId}`}
                loopTaskId={taskId}
                loopRole="worker"
                cwd={cwd}
                terminalBg={terminalBg}
                managedExternally
              />
            </LoopColumn>
          </Panel>
          <PanelResizeHandle className="resize-handle-quiet w-px bg-border/40" />
          <Panel id="loop-manager" order={2} minSize={25} defaultSize={50}>
            <LoopColumn
              icon={<Compass size={13} strokeWidth={1.8} />}
              label="Manager"
              sub="orchestrates · never edits"
            >
              <TerminalPane
                key={`mgr:${taskId}`}
                id={`mgr:${taskId}`}
                loopTaskId={taskId}
                loopRole="manager"
                cwd={cwd}
                terminalBg={terminalBg}
                managedExternally
              />
            </LoopColumn>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function LoopColumn({
  icon,
  label,
  sub,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-2 h-[22px] shrink-0 border-b border-border/40 text-[11px] text-muted-foreground">
        {icon}
        <span className="font-medium text-foreground">{label}</span>
        <span className="opacity-60">· {sub}</span>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
