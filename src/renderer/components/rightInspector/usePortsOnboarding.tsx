import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { PortHeuristicResult } from '../../../shared/types';
import { sessionRegistry } from '../../terminal/SessionRegistry';

const PERMANENT_DISMISS_KEY_PREFIX = 'portsOnboardingDismissed:';
const SESSION_DISMISS_KEY_PREFIX = 'portsOnboardingSessionDismissed:';
const TOAST_ID_PREFIX = 'ports-onboarding:';
const POLL_INTERVAL_MS = 5000;
// Sanity bound. If the agent never writes ports.json the toast shouldn't
// poll forever — give up after 30 minutes and let the user re-trigger setup.
const POLL_MAX_DURATION_MS = 30 * 60 * 1000;

// Projects whose onboarding toast has already entered the viewport in this
// renderer session. Subsequent shows pass the `no-entry-anim` class so
// users who project-hop aren't visually re-poked.
const animatedThisSession = new Set<string>();

// Projects where the user has clicked "Set up" and we're polling for the
// agent to write .dash/ports.json. Outlives task and project switches —
// switching back to a waiting project resumes the waiting toast.
interface WaitingEntry {
  heuristic: PortHeuristicResult;
  pollTimer: ReturnType<typeof setInterval>;
  stopTimer: ReturnType<typeof setTimeout>;
}
const projectsInSetup = new Map<string, WaitingEntry>();

interface UsePortsOnboardingArgs {
  taskId: string | null;
  projectId: string | null;
  /** Called when the user clicks "Set up". Takes taskId so the caller can
   *  be defined outside the React component (stable reference) without
   *  needing to close over activeTask from state. */
  onSetup: (taskId: string, heuristic: PortHeuristicResult) => void;
}

function isDismissed(projectId: string): boolean {
  if (localStorage.getItem(PERMANENT_DISMISS_KEY_PREFIX + projectId) === '1') return true;
  if (sessionStorage.getItem(SESSION_DISMISS_KEY_PREFIX + projectId) === '1') return true;
  return false;
}

function stopPolling(projectId: string): void {
  const entry = projectsInSetup.get(projectId);
  if (!entry) return;
  clearInterval(entry.pollTimer);
  clearTimeout(entry.stopTimer);
  projectsInSetup.delete(projectId);
}

/**
 * Persistent sonner toast that walks the user through port-management setup.
 * Three display states, transitioned in place via sonner's `id`-based
 * update (no re-mount, no re-animation):
 *
 *   - Onboarding: "Port management available" + [Set up][Not now][Never]
 *   - Waiting: "Setup in progress..." + [Cancel] — polls for the agent to
 *     write .dash/ports.json, auto-applies on detection.
 *   - Applied (toast.success): "N ports allocated — restart terminals" —
 *     auto-dismisses after a few seconds.
 *
 * Waiting state survives task and project switches. If the user navigates
 * away mid-setup, the poll keeps running module-side; switching back
 * re-displays the waiting toast.
 */
export function usePortsOnboarding({ taskId, projectId, onSetup }: UsePortsOnboardingArgs): void {
  const activeToastIdRef = useRef<string | null>(null);
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;
  const onSetupRef = useRef(onSetup);
  onSetupRef.current = onSetup;
  // Bumped by the config-change listener when ports.json goes from
  // present-and-valid to absent — forces the main effect to re-evaluate so
  // the toast can come back after a successful setup is rolled back.
  const [reEvalTick, setReEvalTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const dismissActive = () => {
      if (activeToastIdRef.current) {
        toast.dismiss(activeToastIdRef.current);
        activeToastIdRef.current = null;
      }
    };

    if (!projectId) {
      dismissActive();
      return;
    }

    const toastId = TOAST_ID_PREFIX + projectId;
    // Already showing for this project → leave it alone.
    if (activeToastIdRef.current === toastId) return;

    // Switching projects: dismiss the old toast before deciding what to
    // show for the new one.
    dismissActive();

    // If we're already polling for this project's setup, re-display the
    // waiting toast (skip the onboarding path entirely).
    const existing = projectsInSetup.get(projectId);
    if (existing) {
      showWaitingToast(toastId, projectId, existing.heuristic, activeToastIdRef);
      return;
    }

    // Dismissed (permanent or session)? Don't show.
    if (isDismissed(projectId)) return;

    const probeTaskId = taskIdRef.current;
    if (!probeTaskId) return;

    (async () => {
      const resp = await window.electronAPI.portsDetect(probeTaskId);
      if (cancelled) return;
      if (!resp.success || !resp.data) return;
      const heuristic = resp.data;
      if (heuristic.alreadyConfigured || !heuristic.needsPorts) return;
      if (isDismissed(projectId)) return;

      const handleSetup = () => {
        const tid = taskIdRef.current;
        if (tid) onSetupRef.current(tid, heuristic);
        beginWaiting(toastId, projectId, heuristic, activeToastIdRef, taskIdRef);
      };
      const handleNotNow = () => {
        sessionStorage.setItem(SESSION_DISMISS_KEY_PREFIX + projectId, '1');
        toast.dismiss(toastId);
        activeToastIdRef.current = null;
      };
      const handleNever = () => {
        localStorage.setItem(PERMANENT_DISMISS_KEY_PREFIX + projectId, '1');
        toast.dismiss(toastId);
        activeToastIdRef.current = null;
      };

      activeToastIdRef.current = toastId;
      const skipEntryAnim = animatedThisSession.has(projectId);
      animatedThisSession.add(projectId);
      toast(
        <OnboardingToastBody
          heuristic={heuristic}
          onSetup={handleSetup}
          onNotNow={handleNotNow}
          onNever={handleNever}
        />,
        {
          id: toastId,
          duration: Infinity,
          dismissible: false,
          className: skipEntryAnim
            ? 'ports-onboarding-toast no-entry-anim'
            : 'ports-onboarding-toast',
        },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, reEvalTick]);

  // Reactivation: when the user deletes .dash/ports.json (typical scenario:
  // starting setup over on a project already configured in a prior session),
  // PortsConfigWatcher fires this event. The drawer hides itself via
  // usePortsState, but without this listener the session-dismiss flag from
  // the prior successful setup would suppress the toast. Clear the session
  // dismiss + force re-eval so the toast comes back. Permanent dismiss
  // ("Never") is left alone — that's the user's standing preference.
  useEffect(() => {
    if (!projectId) return;
    const off = window.electronAPI.onPortsConfigChanged(async ({ taskId: changedTaskId }) => {
      if (changedTaskId !== taskIdRef.current) return;
      const resp = await window.electronAPI.portsDetect(changedTaskId);
      if (!resp.success || !resp.data) return;
      // Config is still present and valid → drawer handles it, nothing to do.
      if (resp.data.alreadyConfigured) return;
      // Config gone + heuristic still detects port-binding code → reopen
      // the door for the onboarding toast.
      if (resp.data.needsPorts) {
        sessionStorage.removeItem(SESSION_DISMISS_KEY_PREFIX + projectId);
        setReEvalTick((t) => t + 1);
      }
    });
    return off;
  }, [projectId]);
}

/**
 * Transition from the onboarding card to the waiting card, then start a
 * poll loop that detects when the agent writes .dash/ports.json and
 * auto-applies. Caller is responsible for already having invoked the
 * `onSetup` (pre-typing the prompt into the task's TUI).
 */
function beginWaiting(
  toastId: string,
  projectId: string,
  heuristic: PortHeuristicResult,
  activeToastIdRef: React.MutableRefObject<string | null>,
  taskIdRef: React.MutableRefObject<string | null>,
): void {
  showWaitingToast(toastId, projectId, heuristic, activeToastIdRef);

  // Clear any prior poll for this project (e.g. user clicked Set up twice).
  stopPolling(projectId);

  // Lock the poll to the task the user clicked Set up on. If they switch
  // tasks mid-setup (looking at another worktree while the agent works),
  // the poll keeps watching the right worktree instead of following the
  // active task. `taskIdRef.current` was the click-time value because the
  // hook updates the ref synchronously on every render and `handleSetup`
  // ran during the render that captured this poll's closure.
  const setupTaskId = taskIdRef.current;
  if (!setupTaskId) {
    console.warn('[ports] beginWaiting: no taskId at click time, aborting poll');
    return;
  }
  console.log('[ports] watching for .dash/ports.json on task', setupTaskId);

  const pollTimer = setInterval(async () => {
    const resp = await window.electronAPI.portsDetect(setupTaskId);
    if (!resp.success || !resp.data) {
      console.warn('[ports] portsDetect failed:', resp.error);
      return;
    }
    // The file exists but failed to parse. Stop polling and surface the
    // error — the user needs to fix the schema before this can proceed.
    if (resp.data.configError) {
      console.error('[ports] .dash/ports.json invalid:', resp.data.configError);
      stopPolling(projectId);
      toast.dismiss(toastId);
      activeToastIdRef.current = null;
      sessionStorage.setItem(SESSION_DISMISS_KEY_PREFIX + projectId, '1');
      // Custom body (not toast.error) — sonner's default error rendering
      // was hijacking the toast with an "U"-glyph icon that didn't match
      // our frosted-glass styling. Our own JSX gives consistent layout.
      const errorId = TOAST_ID_PREFIX + 'error:' + projectId;
      toast(
        <ConfigErrorToastBody
          message={resp.data.configError}
          onDismiss={() => toast.dismiss(errorId)}
        />,
        {
          id: errorId,
          duration: 15000,
          dismissible: false,
          className: 'ports-onboarding-toast no-entry-anim',
        },
      );
      return;
    }
    if (!resp.data.alreadyConfigured) return;

    // ports.json has appeared. Allocate, write env file, notify the drawer.
    // But DON'T show the "Restart session" prompt yet — the agent is still
    // working on wiring, docs, AskUserQuestion rounds. Restarting now would
    // kill that in-flight work. We swap to a "still working" toast and wait
    // for the agent's setup-complete sentinel (see Step 7 of the slash
    // command body) before prompting to restart.
    console.log('[ports] .dash/ports.json detected on task', setupTaskId, '— allocating');
    stopPolling(projectId);
    const refreshResp = await window.electronAPI.portsRefresh(setupTaskId);
    if (!refreshResp.success || !refreshResp.data || refreshResp.data.length === 0) {
      // ports.json existed but allocation produced nothing — most commonly
      // a schema validation failure (duplicate envVar, port out of range,
      // malformed JSON). Surface so the user can investigate.
      console.warn('[ports] portsRefresh produced no entries:', refreshResp.error);
      toast.dismiss(toastId);
      activeToastIdRef.current = null;
      toast.error(
        'Port allocation ran but produced no entries. Check .dash/ports.json for schema errors.',
      );
      return;
    }

    const allocatedCount = refreshResp.data.length;
    console.log('[ports] allocated', allocatedCount, 'ports — waiting for setup-complete sentinel');
    // Session-dismiss the project. Setup is in progress in this worktree,
    // but sibling worktrees of the same project (branched from main before
    // the setup PR landed) still lack ports.json — without this dismiss,
    // switching to one of those tasks would resurface "Port management
    // available" even though the user is mid-merge.
    sessionStorage.setItem(SESSION_DISMISS_KEY_PREFIX + projectId, '1');
    window.dispatchEvent(
      new CustomEvent('dash:ports:invalidate', { detail: { taskId: setupTaskId } }),
    );

    // Transition to "agent still working" body, same toast id (in-place).
    const showAllocatedToast = () => {
      toast.dismiss(toastId);
      activeToastIdRef.current = null;
      const followUpId = TOAST_ID_PREFIX + 'applied:' + projectId;
      toast(
        <AllocatedToastBody
          count={allocatedCount}
          onRestart={() => {
            sessionRegistry.restartAllForTask(setupTaskId).catch((err) => {
              console.error('[ports] restart-all failed:', err);
              toast.error('Failed to restart session — see console for details.');
            });
            toast.dismiss(followUpId);
          }}
          onDismiss={() => toast.dismiss(followUpId)}
        />,
        {
          id: followUpId,
          duration: Infinity,
          dismissible: false,
          className: 'ports-onboarding-toast no-entry-anim',
        },
      );
    };

    let offSetupComplete: (() => void) | null = null;
    let completeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanupCompletionWatch = () => {
      if (offSetupComplete) offSetupComplete();
      offSetupComplete = null;
      if (completeFallbackTimer) clearTimeout(completeFallbackTimer);
      completeFallbackTimer = null;
    };

    toast(
      <FinishingToastBody
        count={allocatedCount}
        onCancel={() => {
          cleanupCompletionWatch();
          toast.dismiss(toastId);
          activeToastIdRef.current = null;
        }}
      />,
      {
        id: toastId,
        duration: Infinity,
        dismissible: false,
        className: 'ports-onboarding-toast no-entry-anim',
      },
    );

    offSetupComplete = window.electronAPI.onPortsSetupComplete(({ taskId: completeTaskId }) => {
      if (completeTaskId !== setupTaskId) return;
      console.log('[ports] setup-complete sentinel detected — agent done');
      cleanupCompletionWatch();
      showAllocatedToast();
    });

    // Safety net: if the agent never writes the sentinel (skipped Step 7,
    // errored out before getting there, or the user paused mid-flow for a
    // long time), force-show the restart prompt after 20 min so the user
    // isn't stranded on the "finishing" toast forever.
    completeFallbackTimer = setTimeout(
      () => {
        console.warn('[ports] setup-complete sentinel never arrived — falling back');
        cleanupCompletionWatch();
        showAllocatedToast();
      },
      20 * 60 * 1000,
    );
  }, POLL_INTERVAL_MS);

  const stopTimer = setTimeout(() => {
    // Hard cap: if the agent never writes ports.json, stop polling so we
    // don't poll for the rest of the renderer session. User can re-trigger
    // setup from the new toast that appears after dismissal.
    const entry = projectsInSetup.get(projectId);
    if (!entry) return;
    stopPolling(projectId);
    if (activeToastIdRef.current === toastId) {
      toast.dismiss(toastId);
      activeToastIdRef.current = null;
    }
    sessionStorage.setItem(SESSION_DISMISS_KEY_PREFIX + projectId, '1');
    toast.error(
      'Port-management setup timed out. Re-trigger from the toast if the agent finishes later.',
    );
  }, POLL_MAX_DURATION_MS);

  projectsInSetup.set(projectId, { heuristic, pollTimer, stopTimer });
}

function showWaitingToast(
  toastId: string,
  projectId: string,
  heuristic: PortHeuristicResult,
  activeToastIdRef: React.MutableRefObject<string | null>,
): void {
  const handleCancel = () => {
    stopPolling(projectId);
    sessionStorage.setItem(SESSION_DISMISS_KEY_PREFIX + projectId, '1');
    toast.dismiss(toastId);
    activeToastIdRef.current = null;
  };

  activeToastIdRef.current = toastId;
  toast(<WaitingToastBody heuristic={heuristic} onCancel={handleCancel} />, {
    id: toastId,
    duration: Infinity,
    dismissible: false,
    // No entry animation: this is either a transition from the onboarding
    // card (same toast id, sonner updates in place) or a re-show after a
    // project switch — either way the user has already seen it animate.
    className: 'ports-onboarding-toast no-entry-anim',
  });
}

function OnboardingToastBody({
  heuristic,
  onSetup,
  onNotNow,
  onNever,
}: {
  heuristic: PortHeuristicResult;
  onSetup: () => void;
  onNotNow: () => void;
  onNever: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[12px] font-medium text-foreground">Port management available</span>
      <p className="text-[11px] text-foreground/80 leading-snug">
        Looks like a project that runs services. Set up worktree-isolated ports so parallel agents
        don&apos;t fight over <span className="font-mono">:3000</span>.
      </p>
      <span
        className="text-[11px] text-foreground/80 truncate"
        title={heuristic.signals.join(' · ')}
      >
        Detected: {heuristic.signals.join(' · ')}
      </span>
      <div className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSetup}
          className="rounded bg-primary/15 hover:bg-primary/25 text-primary text-[11px] font-medium px-2 py-[3px] transition-colors"
        >
          Set up
        </button>
        <button
          type="button"
          onClick={onNotNow}
          className="rounded hover:bg-accent text-[11px] text-foreground/80 px-2 py-[3px] transition-colors"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={onNever}
          className="rounded hover:bg-accent text-[11px] text-foreground/50 px-2 py-[3px] transition-colors"
        >
          Never
        </button>
      </div>
    </div>
  );
}

function ConfigErrorToastBody({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[12px] font-medium text-[hsl(var(--destructive))]">
        Port management setup failed
      </span>
      <p className="text-[11px] text-foreground/80 leading-snug break-words">
        Dash couldn&apos;t parse <span className="font-mono">.dash/ports.json</span>:
      </p>
      <p
        className="text-[11px] text-foreground/80 font-mono leading-snug break-words bg-surface-2/40 rounded px-1.5 py-1"
        title={message}
      >
        {message}
      </p>
      <div className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded hover:bg-accent text-[11px] text-foreground/80 px-2 py-[3px] transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

function AllocatedToastBody({
  count,
  onRestart,
  onDismiss,
}: {
  count: number;
  onRestart: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[12px] font-medium text-foreground">
        {count} port{count === 1 ? '' : 's'} allocated
      </span>
      <p className="text-[11px] text-foreground/80 leading-snug">
        New env vars are ready. Restart this task&apos;s session to pick them up — Claude will
        resume via <span className="font-mono">--continue</span>, the shell drawer spawns fresh,
        both inherit the new ports.
      </p>
      <div className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onRestart}
          className="rounded bg-primary/15 hover:bg-primary/25 text-primary text-[11px] font-medium px-2 py-[3px] transition-colors"
        >
          Restart session
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded hover:bg-accent text-[11px] text-foreground/80 px-2 py-[3px] transition-colors"
        >
          Later
        </button>
      </div>
    </div>
  );
}

function FinishingToastBody({ count, onCancel }: { count: number; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-1.5">
        <Loader2 size={14} strokeWidth={1.8} className="animate-spin text-foreground/70" />
        <span className="text-[12px] font-medium text-foreground">
          {count} port{count === 1 ? '' : 's'} allocated — agent finishing up
        </span>
      </div>
      <p className="text-[11px] text-foreground/80 leading-snug">
        Ports are in the drawer below. The agent is still wiring code and writing docs — you&apos;ll
        be prompted to restart once it&apos;s done.
      </p>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="flex-1 text-[11px] text-foreground/60">
          Waiting for completion signal…
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded hover:bg-accent text-[11px] text-foreground/80 px-2 py-[3px] transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function WaitingToastBody({
  heuristic,
  onCancel,
}: {
  heuristic: PortHeuristicResult;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-1.5">
        <Loader2 size={14} strokeWidth={1.8} className="animate-spin text-foreground/70" />
        <span className="text-[12px] font-medium text-foreground">Setting up port management…</span>
      </div>
      <p className="text-[11px] text-foreground/80 leading-snug">
        Waiting for the agent to write <span className="font-mono">.dash/ports.json</span>. Dash
        will allocate ports and write the env file automatically once it appears.
      </p>
      <span
        className="text-[11px] text-foreground/80 truncate"
        title={heuristic.signals.join(' · ')}
      >
        Detected: {heuristic.signals.join(' · ')}
      </span>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="flex-1 text-[11px] text-foreground/60">Polling every 5s…</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded hover:bg-accent text-[11px] text-foreground/80 px-2 py-[3px] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
