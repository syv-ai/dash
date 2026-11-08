import type { StreamSink } from '../registry';
import type { TaskView } from './tasks';

/** A line of `dashctl tasks watch`. */
export type TaskWatchEvent =
  | { event: 'task'; task: TaskView }
  | { event: 'removed'; taskId: string };

/**
 * Something else a watch reports about its tasks, beside their views (e.g. a
 * task's reply to a message): given the watch, it emits its own lines for the
 * tasks being watched, and returns its unsubscribe.
 */
export type TaskWatchSource = (watch: {
  isWatched(taskId: string): boolean;
  emit(line: { event: string } & Record<string, unknown>): void;
}) => () => void;

export interface TaskWatchOptions {
  /** The tasks watched now, by id (in scope, not archived). Read again on every change. */
  read(): Map<string, TaskView>;
  /** Watching one task: the stream ends once it is removed. */
  single: boolean;
  /** Change notifications (activity, the task list); each returns its unsubscribe. */
  subscriptions: Array<(listener: () => void) => () => void>;
  /** How often to re-read anyway, for what fires no event (a session's message address). */
  pollMs: number;
  sources?: TaskWatchSource[];
}

/**
 * Stream the watched tasks: each one's view first, then a `task` line whenever
 * a view changes (only then), and `removed` when a task is deleted or archived.
 * Runs until the stream's signal fires, or the single task watched is removed.
 */
export function watchTasks(opts: TaskWatchOptions, stream: StreamSink): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    /** The last view sent, serialized, by task id. */
    const sent = new Map<string, string>();
    const unsubscribes: Array<() => void> = [];
    let done = false;

    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      stream.signal.removeEventListener('abort', onAbort);
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
      if (err === undefined) resolve();
      else reject(err);
    };
    const onAbort = () => finish();

    const check = () => {
      if (done) return;
      try {
        const now = opts.read();
        for (const [id, view] of now) {
          const json = JSON.stringify(view);
          if (sent.get(id) === json) continue;
          sent.set(id, json);
          stream.emit({ event: 'task', task: view } satisfies TaskWatchEvent);
        }
        for (const id of [...sent.keys()]) {
          if (now.has(id)) continue;
          sent.delete(id);
          stream.emit({ event: 'removed', taskId: id } satisfies TaskWatchEvent);
          if (opts.single) finish();
        }
      } catch (err) {
        // Not into the emitter that called us (ActivityMonitor, taskEvents).
        finish(err);
      }
    };

    // Before anything can finish the watch, which clears it.
    const timer = setInterval(check, opts.pollMs);
    if (stream.signal.aborted) return finish();
    stream.signal.addEventListener('abort', onAbort);
    check();
    if (done) return;
    for (const subscribe of opts.subscriptions) unsubscribes.push(subscribe(check));
    const watch = {
      isWatched: (taskId: string) => sent.has(taskId),
      emit: (line: { event: string } & Record<string, unknown>) => {
        if (!done) stream.emit(line);
      },
    };
    for (const source of opts.sources ?? []) unsubscribes.push(source(watch));
  });
}
