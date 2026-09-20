import type { LoopConfig, LoopLevel, LoopPolicy } from '../../../shared/types';
import { Segmented } from '../ui/Segmented';
import { Expandable } from '../ui/Expandable';

/**
 * The loop-creation fields for TaskModal's "Loop" mode. Kept as a self-contained
 * draft (string-typed for inputs) + `buildLoopConfig` converter so the modal
 * only owns one piece of state. See docs/agentic-loops-plan.md §9 for the config
 * shape and §3/§7 for what policy/level mean.
 */
export interface LoopDraft {
  goal: string;
  policy: LoopPolicy;
  level: LoopLevel;
  stopPredicate: string;
  maxIterations: string;
  cadenceMs: string;
  completionPromise: string;
  tokenBudget: string;
  constraints: string;
}

export function defaultLoopDraft(): LoopDraft {
  return {
    goal: '',
    policy: 'ralph',
    level: 'L2',
    stopPredicate: '',
    maxIterations: '10',
    cadenceMs: '',
    completionPromise: '',
    tokenBudget: '',
    constraints: '',
  };
}

/** A loop needs a goal to seed PROMPT.md; everything else has a sane default. */
export function loopDraftValid(d: LoopDraft): boolean {
  return d.goal.trim().length > 0;
}

function positiveInt(s: string): number | undefined {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Convert the UI draft into the persisted LoopConfig, dropping empty fields. */
export function buildLoopConfig(d: LoopDraft): LoopConfig {
  const constraints = d.constraints
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    policy: d.policy,
    goal: d.goal.trim(),
    level: d.level,
    stopPredicate:
      d.policy === 'ralph' || d.policy === 'goal' ? d.stopPredicate.trim() || null : null,
    cadenceMs: d.policy === 'cadence' ? (positiveInt(d.cadenceMs) ?? null) : null,
    maxIterations:
      d.policy === 'ralph' || d.policy === 'count' ? (positiveInt(d.maxIterations) ?? null) : null,
    completionPromise: d.policy === 'count' ? d.completionPromise.trim() || null : null,
    tokenBudget: positiveInt(d.tokenBudget) ?? null,
    constraints: constraints.length > 0 ? constraints : undefined,
  };
}

const POLICY_HINT: Record<LoopPolicy, string> = {
  ralph: 'Fresh context each pass until the stop check passes (or max iterations).',
  goal: 'Iterate until the stop check exits 0.',
  cadence: 'Run every N ms indefinitely — triage / babysitter loops.',
  count: 'Run a fixed number of iterations (or until a completion phrase appears).',
};

const LEVEL_HINT: Record<LoopLevel, string> = {
  L1: 'Report-only — worker edits within the worktree; manager may steer, but pause/kill stay human.',
  L2: 'Assisted — worker accepts edits; manager may pause/kill.',
  L3: 'Unattended — worker runs bypassed; manager has full authority; budget auto-pause armed.',
};

const inputCls =
  'w-full px-3.5 py-2.5 rounded-lg bg-background border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150';
const labelCls = 'block text-[12px] font-medium text-foreground/70 mb-2';

export function LoopFields({
  draft,
  onChange,
  stopPredicatePlaceholder,
}: {
  draft: LoopDraft;
  onChange: (next: LoopDraft) => void;
  /** Suggested stop check (e.g. the project's test+lint) shown as a placeholder. */
  stopPredicatePlaceholder?: string;
}) {
  const set = (patch: Partial<LoopDraft>) => onChange({ ...draft, ...patch });
  const usesStopPredicate = draft.policy === 'ralph' || draft.policy === 'goal';
  const usesMaxIterations = draft.policy === 'ralph' || draft.policy === 'count';

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Goal</label>
        <textarea
          value={draft.goal}
          onChange={(e) => set({ goal: e.target.value })}
          rows={4}
          placeholder="What the worker iterates toward — re-read fresh every pass (PROMPT.md)."
          className={`${inputCls} resize-none`}
          autoFocus
        />
      </div>

      <div>
        <label className={labelCls}>Policy</label>
        <Segmented<LoopPolicy>
          size="sm"
          value={draft.policy}
          onChange={(v) => set({ policy: v })}
          options={[
            { value: 'ralph', label: 'Ralph' },
            { value: 'goal', label: 'Goal' },
            { value: 'cadence', label: 'Cadence' },
            { value: 'count', label: 'Count' },
          ]}
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground/50">{POLICY_HINT[draft.policy]}</p>
      </div>

      <div>
        <label className={labelCls}>Trust level</label>
        <Segmented<LoopLevel>
          size="sm"
          value={draft.level}
          onChange={(v) => set({ level: v })}
          options={[
            { value: 'L1', label: 'L1' },
            { value: 'L2', label: 'L2' },
            { value: 'L3', label: 'L3' },
          ]}
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground/50">{LEVEL_HINT[draft.level]}</p>
      </div>

      {usesStopPredicate && (
        <div>
          <label className={labelCls}>Stop check</label>
          <input
            type="text"
            value={draft.stopPredicate}
            onChange={(e) => set({ stopPredicate: e.target.value })}
            placeholder={stopPredicatePlaceholder || 'e.g. pnpm test && pnpm lint'}
            className={`${inputCls} font-mono text-[12px]`}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground/50">
            Shell command run between iterations — exit 0 means done. Blank = run to max.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4">
        {usesMaxIterations && (
          <div>
            <label className={labelCls}>Max iterations</label>
            <input
              type="number"
              min={1}
              value={draft.maxIterations}
              onChange={(e) => set({ maxIterations: e.target.value })}
              placeholder="10"
              className={inputCls}
            />
          </div>
        )}
        {draft.policy === 'cadence' && (
          <div>
            <label className={labelCls}>Interval (ms)</label>
            <input
              type="number"
              min={1}
              value={draft.cadenceMs}
              onChange={(e) => set({ cadenceMs: e.target.value })}
              placeholder="300000"
              className={inputCls}
            />
          </div>
        )}
        <div>
          <label className={labelCls}>Token budget</label>
          <input
            type="number"
            min={1}
            value={draft.tokenBudget}
            onChange={(e) => set({ tokenBudget: e.target.value })}
            placeholder="optional — auto-pause"
            className={inputCls}
          />
        </div>
      </div>

      {draft.policy === 'count' && (
        <div>
          <label className={labelCls}>Completion phrase</label>
          <input
            type="text"
            value={draft.completionPromise}
            onChange={(e) => set({ completionPromise: e.target.value })}
            placeholder="optional — stop when this appears in worker output"
            className={inputCls}
          />
        </div>
      )}

      <Expandable label="Constraints" hint="optional" labelClassName="text-foreground/70">
        <textarea
          value={draft.constraints}
          onChange={(e) => set({ constraints: e.target.value })}
          rows={4}
          placeholder={
            'One rule per line — injected before every iteration.\ne.g. Never touch src/auth/\nRun tests before finishing'
          }
          className={`${inputCls} font-mono text-[12px] resize-none`}
        />
      </Expandable>
    </div>
  );
}
