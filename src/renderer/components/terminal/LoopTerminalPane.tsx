import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Repeat, Compass } from 'lucide-react';
import { TerminalPane } from './TerminalPane';

interface LoopTerminalPaneProps {
  taskId: string;
  cwd: string;
  terminalBg?: string;
}

/**
 * The two-terminal main pane for an agentic loop (see docs/agentic-loops-plan.md).
 * Left = the Ralph WORKER (fresh context each iteration, acts), right = the
 * persistent MANAGER (orchestrates, never edits code).
 *
 * The renderer only declares which role each terminal hosts (`loopRole`) and
 * that it spawns fresh-context (so the two Claude sessions don't collide on the
 * shared worktree cwd). Main owns the rest of the per-role policy — model,
 * permission, the seed prompt, and the manager's write-deny settings — derived
 * from the task's LoopConfig (see loopSpawn.ts). The PTY ids (`loop:<taskId>` /
 * `mgr:<taskId>`) are what the LoopScheduler and MCP bridge target.
 */
export function LoopTerminalPane({ taskId, cwd, terminalBg }: LoopTerminalPaneProps) {
  return (
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
            freshContext
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
            freshContext
          />
        </LoopColumn>
      </Panel>
    </PanelGroup>
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
