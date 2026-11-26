/** One day of use, as `daily_active_user` and `usage_snapshot` report it. */
export interface UsageDay {
  /** `YYYY-MM-DD` (UTC, like `daily_active_user.date`). */
  date: string;
  /** Minutes a Dash window had focus. */
  activeMinutes: number;
  /** Most sessions working at once. */
  peakBusy: number;
}

export interface UsageLedgerState {
  current: UsageDay | null;
  /** The last closed day, until its report is sent. */
  finished: UsageDay | null;
}

/**
 * A day's active minutes and peak of busy sessions, kept in main and saved
 * with the telemetry config after every change, so a crash loses nothing
 * already counted (`app_session` only fires on a clean quit). A day closes
 * when a later date is seen; the closed day waits in `finished` until the
 * daily reports have read it. Pure: the caller passes the date and saves
 * `toJSON()`.
 */
export class UsageLedger {
  private current: UsageDay | null;
  private closed: UsageDay | null;

  constructor(saved?: Partial<UsageLedgerState>) {
    this.current = asDay(saved?.current);
    this.closed = asDay(saved?.finished);
  }

  get finished(): UsageDay | null {
    return this.closed;
  }

  /** Close the current day if `date` is later. */
  rollTo(date: string): void {
    if (this.current?.date === date) return;
    if (this.current) this.closed = this.current;
    this.current = { date, activeMinutes: 0, peakBusy: 0 };
  }

  addActiveMinute(date: string): void {
    this.rollTo(date);
    this.current!.activeMinutes++;
  }

  /** True when the peak rose (worth saving). */
  noteBusy(count: number, date: string): boolean {
    this.rollTo(date);
    if (count <= this.current!.peakBusy) return false;
    this.current!.peakBusy = count;
    return true;
  }

  clearFinished(): void {
    this.closed = null;
  }

  toJSON(): UsageLedgerState {
    return { current: this.current, finished: this.closed };
  }
}

function asDay(value: unknown): UsageDay | null {
  const v = value as Partial<UsageDay> | null | undefined;
  return v &&
    typeof v.date === 'string' &&
    typeof v.activeMinutes === 'number' &&
    typeof v.peakBusy === 'number'
    ? { date: v.date, activeMinutes: v.activeMinutes, peakBusy: v.peakBusy }
    : null;
}
