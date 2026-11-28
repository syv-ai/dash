import type { HealthPoint } from '@shared/systemHealth';

/**
 * The health popover's timeline: a fixed-size ring of the newest points,
 * read back oldest first and only those within `maxAgeMs` of the newest.
 * Main keeps it, so a reloaded renderer still draws the last two hours.
 * Its memory is capped by `capacity`, whatever the cadence.
 */
export class HealthHistory {
  private readonly ring: (HealthPoint | undefined)[];
  /** Where the next point goes. */
  private head = 0;
  private size = 0;

  constructor(
    private readonly capacity: number,
    private readonly maxAgeMs: number,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be ≥ 1');
    this.ring = new Array<HealthPoint | undefined>(capacity);
  }

  push(point: HealthPoint): void {
    this.ring[this.head] = point;
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  /** Oldest first, none older than `maxAgeMs` before `now` (the newest
   *  point's time by default). */
  points(now?: number): HealthPoint[] {
    const out: HealthPoint[] = [];
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) {
      const p = this.ring[(start + i) % this.capacity];
      if (p) out.push(p);
    }
    const newest = now ?? out[out.length - 1]?.at ?? 0;
    const from = out.findIndex((p) => newest - p.at <= this.maxAgeMs);
    return from === -1 ? [] : out.slice(from);
  }
}
