/**
 * How often an error may be reported: once per key per `windowMs` (a hot
 * loop rejecting the same way), and at most `maxPerHour` in all (a burst of
 * different ones). Pure: the caller passes the time.
 */
export class ErrorThrottle {
  private readonly lastByKey = new Map<string, number>();
  private hourStart = 0;
  private inHour = 0;

  constructor(private readonly opts: { windowMs: number; maxPerHour: number; maxKeys?: number }) {}

  allow(key: string, now: number): boolean {
    const last = this.lastByKey.get(key);
    if (last !== undefined && now - last < this.opts.windowMs) return false;
    if (now - this.hourStart >= 3_600_000) {
      this.hourStart = now;
      this.inHour = 0;
    }
    if (this.inHour >= this.opts.maxPerHour) return false;
    this.inHour++;
    if (this.lastByKey.size >= (this.opts.maxKeys ?? 200)) this.lastByKey.clear();
    this.lastByKey.set(key, now);
    return true;
  }
}
