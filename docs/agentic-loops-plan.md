# Agentic Loops in Dash — Implementation Plan

> Status: in progress — backend core + split-pane UI landed; runtime wiring remains
> Branch: `claude/agentic-loops-dash-ka6xwn`
> Owner: Dash team

## Implementation status

**Landed (type-checked; scheduler core unit-tested — 10 tests):**

1. **Data foundation** — `taskKind` (`standard|loop`) + `loopConfig` JSON across shared
   types, Drizzle schema, a guarded ALTER migration, and DatabaseService
   (map/persist as INSERT-only deep config + `duplicateTask`).
2. **State spine** — `LoopService` seeds/reads `<worktree>/.dash/loop/`
   (PROMPT/LOOP/STATE/loop-constraints/loop-run-log); derived files refresh, evolving
   files preserved.
3. **Fresh-context spawn** — `ptyManager.startDirectPty` gained opt-in `freshContext`
   (no `--resume`, the Ralph reset), a distinct `taskId` for `loop:`/`mgr:` composite
   ids, and a direct `initialPrompt`. Threaded through the renderer spawn path
   (TerminalPane → SessionRegistry → session manager → `pty:startDirect` IPC).
4. **Scheduler core** — `LoopScheduler`, a dependency-injected state machine owning the
   Ralph iteration `while` (per-policy stop check, maxIterations, cadence waits, token
   budget auto-pause, pause/resume/stop). Only busy→idle edges advance it. +
   `ActivityMonitor.subscribe()` for in-process idle signals.
5. **Two-terminal split pane** — `LoopTerminalPane` renders worker|manager; MainContent
   branches on `taskKind`; both spawn fresh-context so their sessions don't collide;
   `projectsStore` disposes `loop:`/`mgr:` PTYs. Standard tasks untouched.

**Remaining (needs a machine that can run the Electron app to verify):**

6. **Scheduler↔PTY adapter (`LoopController`) + IPC** — construct `LoopDriver` from
   ptyManager (`startDirectPty`/`killPtyAwait`/`writePty`) + `child_process` (stop
   check) + `LoopService` (run log) + `webContents` (status); register the worker id
   with `ActivityMonitor.subscribe`; expose `loop:start/pause/resume/stop/status`.
   **Open: worker-spawn ownership.** Today `LoopTerminalPane` spawns the initial
   worker on mount. Recommended resolution: the renderer spawns the _manager_ and the
   _first_ worker iteration; the scheduler owns subsequent Ralph resets
   (`killPtyAwait(loop:<taskId>)` → `startDirectPty(freshContext, initialPrompt =
LoopService.workerIterationPrompt)`), and the renderer's loop terminals do **not**
   auto-respawn on exit (a `managedExternally` flag on the session) so they don't race
   the scheduler.
7. **Loop MCP bridge** — task-scoped MCP server exposing
   `loop_status/get_state/update_state/steer/pause/resume/kill/escalate/append_run_log`,
   attached to the manager via its `.mcp.json`/env. Drives `LoopController`, not the
   CLI's loop.
8. **TaskModal loop mode + duplicate-as-loop** — "Loop" creation mode (goal/policy/
   level/budget/constraints) writing `taskKind='loop'` + `loopConfig`; on create, run
   the worktree path then `LoopService.seed`. Duplicate action → `duplicateTask` with
   `taskKind:'loop'`. Until this lands, a loop task can be created by inserting a row
   with `task_kind='loop'` for manual end-to-end testing.

---

> Original design follows.

First-class support for **agentic loops**: a task can be started _as a loop_, or an
existing task can be _duplicated as a loop_. A loop runs **two terminals side-by-side**
in the main pane — a **loop (worker) agent** that iterates on the goal, and a **loop
manager agent** that orchestrates — connected by an **MCP bridge** so the manager can
observe, steer, pause, and kill the worker.

The conceptual base is [loop-engineering](https://github.com/cobusgreyling/loop-engineering)
(role separation + durable state spine) combined with the **Ralph loop** (Geoffrey
Huntley): _fresh context every iteration, completion judged by external signals, not
self-grading_.

---

## 1. Design decisions (locked)

| Decision          | Choice                           | Why                                                                                                      |
| ----------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Cadence ownership | **Dash-driven scheduler**        | Dash owns the iteration boundary → clean control points for budget gates, manager steer, pause/kill.     |
| Manager authority | **Observe + steer + pause/kill** | Full orchestrator role (loop-engineering's "manager"), gated by loop level.                              |
| Loop mechanism    | **Both policies, Ralph-primary** | Ralph (fresh-context reset) is the default and most important; `goal`/`cadence` are additional policies. |

### Why Dash owns the loop (not the CLI's `/loop` / `/ralph-loop`)

Claude Code ships in-session loop primitives (`/loop`, `/goal`, `/ralph-loop` plugin).
All keep the iteration boundary _inside_ the Claude process — exactly where we need to
insert our scheduler tick, budget gate, manager steer, and pause/kill. If the CLI owns
the loop, Dash fights it for control. **Dash owns the `while`**, so every iteration
boundary is a natural, observable control point. Dash effectively becomes a smarter,
observable Ralph bash loop — which it is already 90% built to be (it spawns/kills PTYs,
tracks idle via `ActivityMonitor`, owns worktrees and the hook server).

We **mirror** the CLI's proven termination semantics as Dash _loop policies_ rather than
reinventing them (see §3).

---

## 2. The Ralph core (primary path)

The worker terminal is a **Ralph iteration loop owned by Dash**:

```
loop:
  spawn FRESH `claude` in the worktree, reading PROMPT.md + STATE.md   # no --resume
  worker does ONE unit of work, writes code + updates STATE.md, commits
  worker goes idle (detected via ActivityMonitor / Stop hook)
  Dash runs the STOP PREDICATE (policy-dependent, §3)
  if satisfied  -> stop, mark loop done
  else          -> kill worker session, loop (fresh context)
```

Two properties are non-negotiable and come straight from Ralph:

1. **Fresh context every iteration.** The worker does **not** `--resume`. Each pass
   starts clean, re-reading `PROMPT.md` + `STATE.md` from disk. This sidesteps context
   rot ("the context window becomes a junk drawer"). _This is the single most important
   new mechanic_ and is a real change from Dash's current always-resume behavior.
2. **External verification, never self-grading.** Completion is decided by an external
   signal (tests/lint exit code, or a manager verdict), not by the worker declaring
   success. "One model. One loop. One verification signal."

> Sophisticated, not complex: the loop itself is deliberately dumb (Ralph). All
> sophistication lives in Dash's orchestration layer — scheduler, budget, manager, MCP,
> state spine — not in fragile prompt machinery.

---

## 3. Loop policies (the only thing that varies is the stop predicate)

`loopConfig.policy` selects the termination mode. The scheduler `while` is identical;
only the **stop predicate** changes.

| Policy                | Mirrors       | Stop predicate                                                               | Worker context      | Use case                                     |
| --------------------- | ------------- | ---------------------------------------------------------------------------- | ------------------- | -------------------------------------------- |
| **`ralph`** (default) | classic Ralph | external signal (tests/lint) **or** manager verdict; optional max-iterations | **reset each pass** | "build/refactor this until correct"          |
| `goal`                | CC `/goal`    | a measurable condition checked each iteration                                | reset each pass     | "all tests on main pass and lint is clean"   |
| `cadence`             | CC `/loop`    | timer — run every N; never self-terminates                                   | reset each pass     | triage / babysitter (PR watcher, CI sweeper) |
| `count`               | `/ralph-loop` | N iterations or completion-promise string                                    | reset each pass     | bounded mechanical sweeps                    |

`ralph` and `goal` are nearly the same; `ralph` defaults the predicate to the project's
test+lint command and adds a safety `maxIterations`. `cadence` is the loop-engineering
"triage/manager loop" shape.

---

## 4. Two-terminal model & role split

|           | **Loop terminal (worker)**                                       | **Manager terminal**                                             |
| --------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| PTY id    | `loop:{taskId}`                                                  | `mgr:{taskId}`                                                   |
| Lifecycle | **ephemeral** — fresh spawn per iteration, killed between passes | **persistent** — one session, `--resume`, context accumulates    |
| Job       | _acts_: edits code, runs tests, updates STATE.md, commits        | _orchestrates_: triage, priorities, budget, escalation decisions |
| Hard rule | —                                                                | **never edits code** (loop-engineering)                          |
| cwd       | task worktree                                                    | task worktree (read/triage role)                                 |
| MCP       | minimal                                                          | **Dash Loop MCP attached**                                       |

This is both the Ralph insight (worker resets) **and** loop-engineering's role split
(worker acts / manager orchestrates; implementer never grades its own homework — the
verifier signal is external).

---

## 5. The MCP bridge ("MCP to interact if needed")

A small **Dash Loop MCP server**, task-scoped, attached to the manager (and optionally
the worker). Hung off the existing hook-server infrastructure (`DASH_HOOK_PORT`) or
spawned per loop task. Surface:

| Tool                                   | Direction           | Effect                                                        |
| -------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `loop_status`                          | read                | current iteration, last run, idle/busy, token spend vs budget |
| `loop_get_state` / `loop_update_state` | read/write          | structured `STATE.md` access                                  |
| `loop_steer(message)`                  | manager → worker    | inject guidance into the next iteration's prompt              |
| `loop_pause` / `loop_resume`           | manager → scheduler | halt/continue the `while`                                     |
| `loop_kill`                            | manager → scheduler | stop the loop (SIGTERM + grace via `ptyManager`)              |
| `loop_escalate(summary)`               | worker → human      | raise a human-gate item the manager surfaces                  |
| `loop_append_run_log(entry)`           | write               | observability into `loop-run-log.md`                          |

These drive **Dash's scheduler**, not the CLI's internal loop. Manager authority
(`steer` / `pause` / `kill`) is gated by loop **level** (§7).

---

## 6. Durable state spine (the load-bearing part)

Seeded into the worktree (or `.dash/loop/`) on loop creation, from templates filled from
`loopConfig`. This is what makes it a real loop, not two chat windows.

| File                  | Role                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| `PROMPT.md`           | the goal re-read fresh by the worker every iteration                               |
| `LOOP.md`             | loop definition: name, level (L1/L2/L3), policy, cadence, handoff rules            |
| `STATE.md`            | live priorities / watchlist / recent-noise (worker + manager read/write)           |
| `loop-constraints.md` | hard rules injected before every iteration ("never edit auth/", "run tests first") |
| `loop-run-log.md`     | per-run: timestamp, items, actions, escalations, token estimate                    |

---

## 7. Phased trust (L1 → L2 → L3)

`loopConfig.level` gates worker permission mode, sub-agent caps, and manager authority:

- **L1 — report-only**: worker read-only / `default` permission; no auto-commit; manager
  may steer but kill stays human. (loop-engineering: never skip L1 on real repos.)
- **L2 — assisted**: worker `acceptEdits`; bounded sub-agents; manager may pause/kill.
- **L3 — unattended**: worker `bypassPermissions`; manager full authority; budget
  auto-pause armed.

---

## 8. Lifecycle

- **Start as loop**: TaskModal gains a "Loop" mode (goal, policy, cadence, level, token
  budget, constraints). Creates task with `taskKind='loop'`, seeds state files, spawns
  both PTYs.
- **Duplicate as loop**: clone an existing task's config + `contextPrompt` → `PROMPT.md`
  goal into a fresh `taskKind='loop'` task with a new worktree. (Also builds the _first_
  task-duplication path — none exists today.)
- **Budget auto-pause**: scheduler pauses when spend crosses the configured threshold and
  notifies the manager/human (loop-engineering kill-switch analogue).

---

## 9. Data model changes

`tasks` table (`src/main/db/schema.ts`):

```ts
taskKind: text('task_kind').notNull().default('standard'),  // 'standard' | 'loop'
loopConfig: text('loop_config'),  // JSON
```

```ts
// loopConfig shape
{
  policy: 'ralph' | 'goal' | 'cadence' | 'count',
  goal: string,                 // -> PROMPT.md
  level: 'L1' | 'L2' | 'L3',
  stopPredicate?: string,       // e.g. test+lint command for ralph/goal
  cadenceMs?: number,           // for 'cadence'
  maxIterations?: number,       // for 'ralph'/'count'
  completionPromise?: string,   // for 'count'
  tokenBudget?: number,
  managerPrompt?: string,
  constraints?: string[],
}
```

Run `pnpm drizzle:generate` for the migration.

---

## 10. File-by-file change list

| Area                    | File(s)                                                                                                       | Change                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Schema + migration      | `src/main/db/schema.ts` + `drizzle:generate`                                                                  | `taskKind`, `loopConfig`                                                                              |
| Task save / duplicate   | `src/main/services/DatabaseService.ts`, `src/main/ipc/dbIpc.ts`                                               | persist loop fields; add `duplicateTask`                                                              |
| **Fresh-context spawn** | `src/main/services/ptyManager.ts` (`buildClaudeArgs`, `startDirectPty` ≈359–517)                              | spawn mode that does **not** `--resume`; allow 2 agent PTYs per task (drop `id===taskId` assumptions) |
| **Scheduler**           | new `src/main/services/LoopScheduler.ts`                                                                      | owns the `while`; idle-detect → stop predicate → re-spawn fresh worker / stop; budget auto-pause      |
| Stop predicate          | new `src/main/services/loopPredicates.ts`                                                                     | per-policy: test/lint exit code, timer, counter, completion-promise                                   |
| State seeding           | new `src/main/services/LoopService.ts`                                                                        | write PROMPT/LOOP/STATE/constraints/run-log from templates                                            |
| MCP bridge              | new `src/main/services/loopMcpServer.ts` (+ hook-server wiring)                                               | tool surface in §5                                                                                    |
| Split UI                | new `src/renderer/components/terminal/LoopTerminalPane.tsx`; `src/renderer/components/MainContent.tsx` (≈300) | branch on `taskKind==='loop'` → horizontal `PanelGroup` of two `TerminalPane`s                        |
| Disposal                | `src/renderer/stores/projectsStore.ts` (`disposeTaskSessions`)                                                | dispose `loop:` + `mgr:` ids                                                                          |
| Modal                   | `src/renderer/components/task/TaskModal.tsx`                                                                  | loop mode (policy/level/budget/constraints) + duplicate-as-loop action                                |
| Types                   | `src/shared/types.ts`, `src/types/electron-api.d.ts`                                                          | loop config + new IPC                                                                                 |

---

## 11. Build order

1. **Schema + types** — `taskKind`, `loopConfig`, migration.
2. **Fresh-context spawn mode** in `ptyManager` (the keystone) + two-PTY-per-task support.
3. **Split main pane** (`LoopTerminalPane`) — visual proof with two terminals.
4. **LoopScheduler** with `ralph` policy only (test/lint stop predicate) — end-to-end loop.
5. **State spine** seeding (`LoopService`) + `PROMPT.md` re-read.
6. **MCP bridge** — `status`/`state`/`steer`/`pause`/`kill`; wire manager terminal.
7. **TaskModal** loop mode + **duplicate-as-loop**.
8. Remaining policies (`goal`/`cadence`/`count`), L1/L2/L3 gating, budget auto-pause.

MVP = steps 1–6 (Ralph end-to-end with both terminals and manager control). Steps 7–8
round out the product.

---

## 11a. Authority, manager model & worktree cohabitation (locked)

**Manager model ≥ worker.** The manager is an _overseer_; evaluation is at least as hard
as generation, so a model weaker than the worker can't reliably grade it. Default the
manager to the worker's tier (`resolveAgentModel` mirrors it); `managerWeakerThanWorker`
flags the anti-pattern for a modal warning. Cost is contained because the manager runs
**episodically** (between iterations) while the worker runs continuously, and the
manager's mechanical work (state reads, run-log, status) is offloaded to MCP tools, not
model tokens.

**How the manager manages — capabilities, not vibes.** Its _decisions_ are its own
judgment; its _actions_ are a fixed, enforced set:

- **Enforced by Dash:** can't edit code (separate process + write-deny settings); can't
  exceed budget (scheduler auto-pause); pause/resume/kill are real scheduler ops, gated
  by level and logged to the run-log.
- **Soft (its judgment):** priorities, when to intervene, what to escalate.
- **Steering channel:** because the worker resets context each pass, the manager steers
  by appending to `manager-notes.md`, which the next fresh worker reads. Urgent control
  goes through the loop MCP (pause/kill). It shapes the _inputs_ of the next iteration,
  never a live session it's about to discard.

**Permission is the wrong lever; capability shaping is right.** `default` prompts on
_every_ tool (including reads) → an autonomous manager would stall on `grep`/`git log`.
None of the three modes is "reads yes, writes no." So the manager runs **unprompted**
(`bypassPermissions`) with a **write-deny policy passed via `claude --settings`** —
per-process, because the two agents share a worktree and a cwd settings file can't differ
per agent. Deny beats every allow and PreToolUse denial is independent of permission mode,
so `Write/Edit/MultiEdit/NotebookEdit` are a hard block and the git-write/destructive Bash
patterns cover the rest (see `MANAGER_DENY` in `loopSpawn.ts`).

**Worktree cohabitation.** Dash's rule is really "one _non-worktree_ task per path," whose
deeper invariant is "unique cwd → deterministic `--resume`." A loop is **one task**, so it
doesn't violate the rule; the resume invariant is preserved because **both loop agents
spawn `freshContext`** (never resume-by-mtime → no session-file collision). Git-write
safety in the shared worktree holds because **only the worker writes** (single writer → no
`index.lock` races). A shared worktree is correct by design — the manager must see the
worker's _actual_ state — so we make cohabitation safe rather than splitting it.

## 12. Open questions

- Worker visibility: run the worker interactive (visible, your two-PTY vision) while Dash
  still drives the iteration boundary — confirmed approach; headless `-p` is a later
  option for unattended L3.
- Where state files live: in the worktree root (auditable in git) vs `.dash/loop/`
  (out of the diff). Leaning worktree root for L1/L2 auditability.
- Multi-loop coordination across tasks (loop-engineering's collision detection / branch
  ownership) — deferred past MVP.
