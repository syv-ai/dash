import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Repeat, Compass } from 'lucide-react';
import type { LoopConfig, PermissionMode } from '../../../shared/types';
import { TerminalPane } from './TerminalPane';

interface LoopTerminalPaneProps {
  taskId: string;
  cwd: string;
  permissionMode?: PermissionMode;
  loopConfig: LoopConfig | null;
  terminalBg?: string;
}

/**
 * The two-terminal main pane for an agentic loop (see docs/agentic-loops-plan.md).
 * Left = the Ralph WORKER (fresh context each iteration, acts), right = the
 * persistent MANAGER (orchestrates, never edits code). Both spawn fresh-context
 * so their Claude sessions don't collide on the shared worktree cwd; each reads
 * the on-disk loop spine (.dash/loop/*) that LoopService seeds.
 *
 * The PTY ids (`loop:<taskId>` / `mgr:<taskId>`) are what the LoopScheduler and
 * MCP bridge target for steer/pause/kill.
 */
export function LoopTerminalPane({
  taskId,
  cwd,
  permissionMode,
  loopConfig,
  terminalBg,
}: LoopTerminalPaneProps) {
  const workerPrompt = seedWorkerPrompt();
  const managerPrompt = loopConfig?.managerPrompt?.trim() || seedManagerPrompt();

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
            cwd={cwd}
            permissionMode={permissionMode}
            terminalBg={terminalBg}
            freshContext
            initialPrompt={workerPrompt}
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
            cwd={cwd}
            // Manager triages/steers; default permission keeps it from editing code.
            permissionMode="default"
            terminalBg={terminalBg}
            freshContext
            initialPrompt={managerPrompt}
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

function seedWorkerPrompt(): string {
  return [
    'You are the LOOP WORKER. First read .dash/loop/loop-constraints.md and obey every rule.',
    'Then read .dash/loop/PROMPT.md (the goal) and .dash/loop/STATE.md (what past iterations did).',
    'Do ONE focused, committable unit of work toward the goal. Run the project tests/lint.',
    'Update .dash/loop/STATE.md with what you did and what remains, then commit.',
    'Do NOT declare the overall goal done yourself — an external check decides that.',
    'If blocked or ambiguous, write it under "Needs human" in STATE.md and stop.',
  ].join(' ');
}

function seedManagerPrompt(): string {
  return [
    'You are the LOOP MANAGER. Read .dash/loop/LOOP.md and .dash/loop/STATE.md.',
    'Track progress, keep priorities current in STATE.md, and decide what needs human attention.',
    'You NEVER edit code — the worker is the only writer. You orchestrate: observe, prioritise,',
    'and steer or pause the worker when needed.',
  ].join(' ');
}
