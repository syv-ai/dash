/** Where a followed setup log goes (the Setup tab's xterm). */
export interface SetupLogSink {
  /** Replace everything shown with `text` (a snapshot, or '' for a new run). */
  reset: (text: string, trimmed: boolean) => void;
  /** New output after the last reset. */
  append: (chunk: string) => void;
}

/**
 * Follow one worktree's setup output: a snapshot from main, then live chunks,
 * then a fresh start whenever a new run begins. Main pushes pending output
 * before it answers the snapshot, so chunks that land before the answer are
 * already in it and are dropped. Returns the unsubscribe.
 */
export function followSetupLog(worktreePath: string, sink: SetupLogSink): () => void {
  let cancelled = false;
  let live = false;
  // Bumped by each new run, so a snapshot that answers after one is dropped.
  let generation = 0;

  const offOutput = window.electronAPI.onWorktreeSetupOutput((d) => {
    if (live && d.worktreePath === worktreePath) sink.append(d.chunk);
  });
  const offChanged = window.electronAPI.onWorktreeSetupChanged((run) => {
    if (run.worktreePath !== worktreePath || run.status !== 'running') return;
    generation++;
    sink.reset('', false);
    live = true;
  });

  const asked = generation;
  void window.electronAPI.worktreeSetupLog(worktreePath).then((resp) => {
    if (cancelled || asked !== generation) return;
    const log = resp.success && resp.data ? resp.data : { text: '', trimmed: false };
    sink.reset(log.text, log.trimmed);
    live = true;
  });

  return () => {
    cancelled = true;
    offOutput();
    offChanged();
  };
}
