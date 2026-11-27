/**
 * Process-tree memory: parse one `ps -A -o pid=,ppid=,rss=` listing for the
 * tree, read each process's memory, then sum each root's subtree. Pure, so the
 * sampling in SystemHealthService stays a thin shell around it.
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

/**
 * macOS physical footprint (`proc_pid_rusage` → `ri_phys_footprint`, what
 * Activity Monitor's Memory column and `footprint -p` show) for every pid
 * passed as an argument, one `<pid> <bytes>` line each. RSS misleads there: it
 * counts shared pages and drops compressed ones, so one process read 1.36 GB
 * RSS against a 74 MB footprint, and swung to 281 MB within 5 s.
 *
 * Node has no binding and `top` costs ~0.6 s of CPU per listing, so this runs
 * the same call libproc makes, through the system Perl: the `proc_info`
 * syscall (336), PROC_INFO_CALL_PIDRUSAGE (9), RUSAGE_INFO_V0 (0), whose
 * `rusage_info_v0` holds `ri_phys_footprint` at byte 72 (16-byte uuid, then
 * seven uint64s). ~5 ms for a few dozen pids. A pid it can't read (exited, or
 * another user's) prints nothing.
 */
export const FOOTPRINT_PERL = [
  'for (@ARGV) {',
  '  my $b = "\\0" x 96;',
  '  print "$_ ", unpack("Q<", substr($b, 72, 8)), "\\n" if syscall(336, 9, $_ + 0, 0, 0, $b, 96) == 0;',
  '}',
].join('\n');

/** Parse FOOTPRINT_PERL's `<pid> <bytes>` lines; anything else is skipped. */
export function parseFootprints(stdout: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) out.set(Number(m[1]), Number(m[2]));
  }
  return out;
}

function childIndex(rows: readonly ProcRow[]): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const r of rows) {
    // pid 0/1 parent everything orphaned; a self-parented row would loop.
    if (r.ppid === r.pid) continue;
    const list = children.get(r.ppid);
    if (list) list.push(r.pid);
    else children.set(r.ppid, [r.pid]);
  }
  return children;
}

/** Every pid in the subtrees of `rootPids`, the roots included: the processes
 *  worth measuring, so the footprint read never walks the whole system. */
export function subtreePids(rows: readonly ProcRow[], rootPids: Iterable<number>): Set<number> {
  const children = childIndex(rows);
  const out = new Set<number>();
  const stack = [...rootPids];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (out.has(pid)) continue;
    out.add(pid);
    for (const child of children.get(pid) ?? []) stack.push(child);
  }
  return out;
}

export interface TreeRoot<K> {
  key: K;
  pid: number;
}

/**
 * Bytes held by each root's process subtree, each process counted at
 * `bytesByPid` (0 when absent). Every process counts once: the roots are walked
 * in order and a process an earlier root already took (a nested root) adds
 * nothing to a later one. So list the narrow roots (task sessions) before the
 * wide one (Dash's main process).
 *
 * A root missing from the listing still counts itself (Windows has no `ps`, so
 * there Electron's own processes are bare roots); one that has exited gets 0.
 */
export function subtreeBytes<K>(
  rows: readonly ProcRow[],
  roots: readonly TreeRoot<K>[],
  bytesByPid: ReadonlyMap<number, number>,
): Map<K, number> {
  const children = childIndex(rows);
  const taken = new Set<number>();
  const out = new Map<K, number>();
  for (const root of roots) {
    let bytes = 0;
    const stack = [root.pid];
    while (stack.length > 0) {
      const pid = stack.pop()!;
      if (taken.has(pid)) continue;
      taken.add(pid);
      bytes += bytesByPid.get(pid) ?? 0;
      for (const child of children.get(pid) ?? []) stack.push(child);
    }
    out.set(root.key, (out.get(root.key) ?? 0) + bytes);
  }
  return out;
}

/** Each row's RSS in bytes: the memory map where no footprint is to be had. */
export function rssBytes(rows: readonly ProcRow[]): Map<number, number> {
  return new Map(rows.map((r) => [r.pid, r.rssKb * 1024]));
}

/** Footprint where it was read, RSS for the rest (a process another user owns,
 *  such as a `sudo` in a terminal, has no readable footprint). */
export function footprintOrRss(
  rows: readonly ProcRow[],
  footprints: ReadonlyMap<number, number>,
): Map<number, number> {
  const out = rssBytes(rows);
  for (const [pid, bytes] of footprints) out.set(pid, bytes);
  return out;
}
