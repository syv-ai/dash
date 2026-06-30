import { promises as fs } from 'fs';
import path from 'path';
import type { LoopConfig } from '@shared/types';

/**
 * The durable state spine for an agentic loop (see docs/agentic-loops-plan.md).
 *
 * Loop-engineering's load-bearing idea is that a loop's memory lives in files
 * OUTSIDE the conversation, so each fresh Ralph iteration starts from the same
 * known state instead of cold. This service seeds and reads those files.
 *
 * Files live under `<worktree>/.dash/loop/` (kept out of the user's code diff,
 * consistent with Dash's other `.dash/` bookkeeping):
 *   - PROMPT.md          the goal, re-read fresh by the worker every iteration
 *   - LOOP.md            the loop definition (policy/level/cadence/handoff)
 *   - STATE.md           live priorities / watchlist / recent-noise (evolving)
 *   - loop-constraints.md  hard rules injected before every iteration
 *   - loop-run-log.md    append-only observability
 *
 * Derived files (PROMPT/LOOP/constraints) are rewritten from config on every
 * seed; evolving files (STATE/run-log) are created only when absent so a re-seed
 * never wipes accumulated memory.
 */
export class LoopService {
  static readonly DIR = path.join('.dash', 'loop');

  static readonly FILES = {
    prompt: 'PROMPT.md',
    loop: 'LOOP.md',
    state: 'STATE.md',
    constraints: 'loop-constraints.md',
    runLog: 'loop-run-log.md',
  } as const;

  /** Absolute path to the loop's state directory inside a worktree. */
  static dir(worktreePath: string): string {
    return path.join(worktreePath, LoopService.DIR);
  }

  private static file(worktreePath: string, name: string): string {
    return path.join(LoopService.dir(worktreePath), name);
  }

  private static async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Seed (or refresh) the state spine for a loop task. Idempotent: derived files
   * are rewritten, evolving files are preserved if they already exist.
   */
  static async seed(worktreePath: string, taskName: string, config: LoopConfig): Promise<void> {
    const dir = LoopService.dir(worktreePath);
    await fs.mkdir(dir, { recursive: true });

    // Derived from config — always rewritten so edits to the loop definition take effect.
    await fs.writeFile(LoopService.file(worktreePath, LoopService.FILES.prompt), promptMd(config));
    await fs.writeFile(
      LoopService.file(worktreePath, LoopService.FILES.loop),
      loopMd(taskName, config),
    );
    await fs.writeFile(
      LoopService.file(worktreePath, LoopService.FILES.constraints),
      constraintsMd(config),
    );

    // Evolving — only create when missing so re-seed never clobbers memory.
    const statePath = LoopService.file(worktreePath, LoopService.FILES.state);
    if (!(await LoopService.exists(statePath))) {
      await fs.writeFile(statePath, stateMd(taskName));
    }
    const runLogPath = LoopService.file(worktreePath, LoopService.FILES.runLog);
    if (!(await LoopService.exists(runLogPath))) {
      await fs.writeFile(runLogPath, runLogMd(taskName));
    }
  }

  static async readState(worktreePath: string): Promise<string> {
    try {
      return await fs.readFile(LoopService.file(worktreePath, LoopService.FILES.state), 'utf8');
    } catch {
      return '';
    }
  }

  static async writeState(worktreePath: string, content: string): Promise<void> {
    await fs.mkdir(LoopService.dir(worktreePath), { recursive: true });
    await fs.writeFile(LoopService.file(worktreePath, LoopService.FILES.state), content);
  }

  static async readPrompt(worktreePath: string): Promise<string> {
    try {
      return await fs.readFile(LoopService.file(worktreePath, LoopService.FILES.prompt), 'utf8');
    } catch {
      return '';
    }
  }

  /** Append one run-log entry. Best-effort; never throws into the scheduler. */
  static async appendRunLog(worktreePath: string, entry: string): Promise<void> {
    try {
      await fs.mkdir(LoopService.dir(worktreePath), { recursive: true });
      await fs.appendFile(
        LoopService.file(worktreePath, LoopService.FILES.runLog),
        entry.endsWith('\n') ? entry : entry + '\n',
      );
    } catch (err) {
      console.error('[LoopService.appendRunLog] failed', err);
    }
  }

  /**
   * The exact prompt handed to a fresh worker iteration. It deliberately points
   * the worker at the on-disk spine (Ralph: re-read state every pass) and forbids
   * self-grading — completion is an external signal, judged by the scheduler.
   */
  static workerIterationPrompt(config: LoopConfig): string {
    const rel = (name: string) => path.posix.join('.dash', 'loop', name);
    const lines = [
      `You are the LOOP WORKER for an agentic loop. Goal:`,
      ``,
      config.goal.trim(),
      ``,
      `Before doing anything, read ${rel(LoopService.FILES.constraints)} and obey every rule in it.`,
      `Then read ${rel(LoopService.FILES.state)} for current priorities and what past iterations already did.`,
      ``,
      `Do ONE focused unit of work this iteration (one task / one fix). Keep the`,
      `change small and committable. Run the project's tests/lint before finishing.`,
      `Update ${rel(LoopService.FILES.state)} with what you did and what remains, then commit.`,
      ``,
      `Do NOT declare the overall goal "done" yourself — an external check decides`,
      `that. If you are blocked or the next step is ambiguous, write the blocker into`,
      `${rel(LoopService.FILES.state)} under "Needs human" and stop.`,
    ];
    return lines.join('\n');
  }
}

// ── Templates ────────────────────────────────────────────────
// These encode loop-engineering best practice (2026): role separation, external
// verification over self-grading, durable state, constraints injected each cycle,
// budgets + human gates, one-task-per-iteration.

function policyLine(config: LoopConfig): string {
  switch (config.policy) {
    case 'ralph':
      return `ralph — re-run the goal with fresh context each pass until the stop check passes${
        config.maxIterations ? ` (max ${config.maxIterations} iterations)` : ''
      }`;
    case 'goal':
      return `goal — iterate until the stop check exits 0`;
    case 'cadence':
      return `cadence — run every ${config.cadenceMs ?? 0}ms indefinitely`;
    case 'count':
      return `count — run ${config.maxIterations ?? '∞'} iterations${
        config.completionPromise ? ` or until "${config.completionPromise}" appears` : ''
      }`;
  }
}

function promptMd(config: LoopConfig): string {
  return `# Loop goal

${config.goal.trim()}

---
_Re-read fresh every iteration. The worker does ONE unit of work per pass, updates
STATE.md, and commits. Completion is judged by an external check, never self-graded._
`;
}

function loopMd(taskName: string, config: LoopConfig): string {
  return `# LOOP — ${taskName}

| Field | Value |
| --- | --- |
| Policy | ${policyLine(config)} |
| Level | ${config.level} |
| Stop check | ${config.stopPredicate ? '`' + config.stopPredicate + '`' : '— (no auto-stop)'} |
| Token budget | ${config.tokenBudget ?? '—'} |

## Roles
- **Worker** (left terminal): acts. Fresh context each iteration, reads PROMPT.md +
  STATE.md, does one unit of work, runs the stop check, updates STATE.md, commits.
- **Manager** (right terminal): orchestrates. Persistent context. Reads STATE.md and
  the run log, sets priorities, and may steer / pause / kill the worker via MCP.
  **Never edits code** — the worker is the only writer.

## Handoff to human
Escalate (write under "Needs human" in STATE.md and stop) when a decision is
ambiguous or high-risk, or when the token budget is exceeded.

_Managed by Dash. See docs/agentic-loops-plan.md._
`;
}

function stateMd(taskName: string): string {
  return `# STATE — ${taskName}

_Durable loop memory. Worker and manager both read/write this. Keep it current._

## High priority
- (none yet)

## Watch list
- (none yet)

## Recent (done)
- (none yet)

## Needs human
- (none)
`;
}

function constraintsMd(config: LoopConfig): string {
  const rules = config.constraints?.length
    ? config.constraints
    : [
        'Make one small, committable change per iteration.',
        'Run the project tests/lint before finishing an iteration.',
        'Never force-push or rewrite published history.',
        'If a step is ambiguous or destructive, stop and escalate to the human.',
      ];
  return `# Loop constraints

_Injected before every iteration. The worker must obey every rule here BEFORE
acting. Add rules the loop must never break._

${rules.map((r) => `- ${r}`).join('\n')}
`;
}

function runLogMd(taskName: string): string {
  return `# Loop run log — ${taskName}

_Append-only. One line per iteration: timestamp · iteration · outcome · notes._
`;
}
