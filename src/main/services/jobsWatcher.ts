import * as fs from 'fs';
import * as path from 'path';

/**
 * The one file in a job's folder (`<claude config dir>/jobs/<id>/`) whose
 * change can mean its `claude agents` row changed. Claude Code rewrites it
 * atomically (`state.json.tmp.<hex>` renamed over it) on every state, detail
 * or wait change. Its siblings are not row data: `timeline.jsonl` is the
 * session's log, `recap.trigger` and `adopt.json` are markers, and `tmp/` is
 * the session's scratch space, which can take hundreds of writes a second.
 */
export const JOB_STATE_FILE = 'state.json';

/**
 * Whether an `fs.watch` event in a job's folder may mean its session changed.
 * A null filename (the platform didn't say which entry) counts, to be safe.
 */
export function isJobStateEvent(filename: string | null): boolean {
  return filename === null || filename === JOB_STATE_FILE;
}

/** Which job folders appeared and went since the last look. */
export function diffJobDirs(
  watched: Iterable<string>,
  present: Iterable<string>,
): { added: string[]; removed: string[] } {
  const before = new Set(watched);
  const now = new Set(present);
  return {
    added: [...now].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !now.has(id)),
  };
}

/**
 * Tells its owner when a background session may have changed, from
 * `<claude config dir>/jobs`: a job folder appearing or going, or a job's
 * `state.json` being rewritten. Every watch is non-recursive, so the writes a
 * session makes deep in its `tmp/` never reach JS: macOS libuv drops FSEvents
 * from below a non-recursive watch's folder, and Linux reports only direct
 * children. Windows reports a direct child folder's own change too (the root
 * watch sees `<job>` on each state.json rewrite, a job watch sees `tmp` when
 * its entries change); the filters drop those. A recursive watch here would,
 * on Linux, also put an inotify watch on every folder of every job's `tmp/`.
 */
export class JobsWatcher {
  private root: fs.FSWatcher | null = null;
  private jobs = new Map<string, fs.FSWatcher>();

  constructor(
    private readonly dir: string,
    private readonly onChange: () => void,
  ) {}

  get watching(): boolean {
    return this.root !== null;
  }

  /** Start watching; false when the jobs folder doesn't exist (yet) or can't be watched. */
  start(): boolean {
    if (this.root) return true;
    try {
      this.root = fs.watch(this.dir, () => this.sync());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[JobsWatcher] fs.watch on the jobs folder failed:', err);
      }
      return false;
    }
    this.root.on('error', () => this.stop());
    this.sync();
    return true;
  }

  stop(): void {
    this.root?.close();
    this.root = null;
    for (const w of this.jobs.values()) w.close();
    this.jobs.clear();
  }

  /** Match the per-job watches to the job folders there are now. */
  private sync(): void {
    if (!this.root) return;
    let present: string[];
    try {
      present = fs
        .readdirSync(this.dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      // The jobs folder went; the root watch errors or closes with it.
      return;
    }
    const { added, removed } = diffJobDirs(this.jobs.keys(), present);
    for (const id of removed) this.unwatchJob(id);
    for (const id of added) this.watchJob(id);
    if (added.length > 0 || removed.length > 0) this.onChange();
  }

  private watchJob(id: string): void {
    try {
      const w = fs.watch(path.join(this.dir, id), (_event, filename) => {
        if (isJobStateEvent(filename)) this.onChange();
      });
      w.on('error', () => this.unwatchJob(id));
      this.jobs.set(id, w);
    } catch {
      // Gone between readdir and watch: the root watch reports it.
    }
  }

  private unwatchJob(id: string): void {
    this.jobs.get(id)?.close();
    this.jobs.delete(id);
  }
}
