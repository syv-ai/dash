/**
 * Process-tree memory from one `ps -A -o pid=,ppid=,rss=` listing: parse it,
 * then sum each root's subtree. Pure, so the sampling in SystemHealthService
 * stays a thin shell around it.
 */

export interface ProcRow {
  pid: number;
  ppid: number;
  /** Resident set size in KiB, as `ps` prints it. */
  rssKb: number;
}

/** Parse `ps -A -o pid=,ppid=,rss=` output. Lines that aren't three whole numbers are skipped. */
export function parsePs(stdout: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid <= 0) continue;
    rows.push({ pid, ppid: Number(m[2]), rssKb: Number(m[3]) });
  }
  return rows;
}

export interface TreeRoot<K> {
  key: K;
  pid: number;
}

/**
 * Bytes held by each root's process subtree. Every process counts once: the
 * roots are walked in order and a process an earlier root already took (a
 * nested root, or a pid in `skip`) adds nothing to a later one. So list the
 * narrow roots (task sessions) before the wide one (Dash's main process), and
 * pass in `skip` the processes measured some other way (Electron's own, from
 * `app.getAppMetrics()`) — their children still count.
 *
 * A root missing from the listing (the process has exited) gets 0.
 */
export function subtreeBytes<K>(
  rows: readonly ProcRow[],
  roots: readonly TreeRoot<K>[],
  skip: ReadonlySet<number> = new Set(),
): Map<K, number> {
  const rss = new Map<number, number>();
  const children = new Map<number, number[]>();
  for (const r of rows) {
    rss.set(r.pid, r.rssKb);
    // pid 0/1 parent everything orphaned; a self-parented row would loop.
    if (r.ppid === r.pid) continue;
    const list = children.get(r.ppid);
    if (list) list.push(r.pid);
    else children.set(r.ppid, [r.pid]);
  }

  const taken = new Set<number>();
  const out = new Map<K, number>();
  for (const root of roots) {
    let kb = 0;
    const stack = rss.has(root.pid) ? [root.pid] : [];
    while (stack.length > 0) {
      const pid = stack.pop()!;
      if (taken.has(pid)) continue;
      taken.add(pid);
      if (!skip.has(pid)) kb += rss.get(pid) ?? 0;
      for (const child of children.get(pid) ?? []) stack.push(child);
    }
    out.set(root.key, (out.get(root.key) ?? 0) + kb * 1024);
  }
  return out;
}
