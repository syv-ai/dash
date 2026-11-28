import type { UsageLimitHit } from '@shared/types';
import { mergeRateLimits } from '@shared/rateLimits';
import { broadcast } from '../utils/broadcast';
import { activityMonitor } from './ActivityMonitor';
import { contextUsageService } from './ContextUsageService';
import {
  clearLimit,
  hitLimit,
  inferLimitHit,
  limitExpired,
  NO_LIMIT,
  type UsageLimitState,
} from './usageLimitState';

/** Main → renderer: the account's usage limit hit, or null. */
export const USAGE_LIMIT_CHANNEL = 'pty:usageLimit';

/** setTimeout's ceiling (~24.8 days); a weekly reset is re-armed past it. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The account's usage limit (usageLimitState). A StopFailure `rate_limit`
 * sets it; it holds until the window's reset time passes, Claude Code's
 * auto-resume fires (the limit is over), or any task's turn succeeds. On
 * clearing, the tasks it turned red go back to idle.
 */
class UsageLimitServiceImpl {
  private state: UsageLimitState = NO_LIMIT;
  private timer: ReturnType<typeof setTimeout> | null = null;

  get(): UsageLimitHit | null {
    return this.state.hit;
  }

  /**
   * A task's turn ended on `rate_limit`; `text` is what Claude Code showed
   * (`last_assistant_message`, else `error_details`). The hit to notify
   * about, once per hit; null for a repeat.
   */
  noteRateLimited(ptyId: string, text: string | undefined): UsageLimitHit | null {
    const now = Date.now();
    const limits = mergeRateLimits(contextUsageService.getAllStatusLine(), now);
    const r = hitLimit(this.state, ptyId, inferLimitHit(text, limits, now), now);
    const changed = r.state.hit !== this.state.hit;
    this.state = r.state;
    if (changed) {
      this.arm();
      this.emit();
    }
    return r.notify ? r.state.hit : null;
  }

  /** The limit is over: a turn succeeded, or auto-resume fired (or found it reset). */
  noteLimitOver(): void {
    if (!this.state.hit) return;
    const { state, revert } = clearLimit(this.state);
    this.state = state;
    this.disarm();
    for (const id of revert) activityMonitor.clearError(id, 'rate_limit');
    this.emit();
  }

  stop(): void {
    this.disarm();
    this.state = NO_LIMIT;
  }

  private arm(): void {
    this.disarm();
    const resetsAt = this.state.hit?.resetsAt ?? 0;
    if (!resetsAt) return;
    const delay = Math.max(0, resetsAt * 1000 - Date.now());
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (limitExpired(this.state, Date.now())) this.noteLimitOver();
        else this.arm();
      },
      Math.min(delay, MAX_TIMER_MS),
    );
    this.timer.unref?.();
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(): void {
    broadcast(USAGE_LIMIT_CHANNEL, this.state.hit);
  }
}

export const usageLimitService = new UsageLimitServiceImpl();
