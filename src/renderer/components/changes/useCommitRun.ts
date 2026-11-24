import { useEffect, useRef, useState } from 'react';
import {
  commitRunReducer,
  initialRunningState,
  type CommitRunEvent,
  type CommitRunState,
} from './commitRunReducer';

export interface CommitRun {
  state: CommitRunState;
  /** Start a commit of the staged files; throws when git refuses to start. */
  start: (message: string, allowEmpty: boolean, stagedPaths: string[]) => Promise<void>;
  cancel: () => void;
  /** Leave a finished run's view for the file list. */
  dismiss: () => void;
  /** Files a hook re-wrote: staged before the commit, unstaged after it failed. */
  autoFixPaths: (unstagedPaths: ReadonlySet<string>) => string[];
  /** Stage the hook's fixes and commit again with the same message. */
  stageFixesAndRetry: (paths: string[]) => Promise<void>;
}

/**
 * One commit at a time in `cwd`, with its hooks streamed in: the commit button
 * starts it, the changes panel shows it. Lives above both, so a run survives
 * the panel swapping its file list for the diff editor.
 */
export function useCommitRun(cwd: string, onFinished: () => void): CommitRun {
  const [state, setState] = useState<CommitRunState>({ status: 'idle' });
  const prevStagedRef = useRef<string[]>([]);
  const lastRef = useRef({ message: '', allowEmpty: false });
  const requestId = state.status === 'running' ? state.requestId : null;

  // The reducer ignores events once the run has left the running state.
  useEffect(() => {
    if (!requestId) return;
    return window.electronAPI.onCommitEvent((msg) => {
      if (msg.requestId !== requestId) return;
      setState((s) =>
        s.status === 'running' ? commitRunReducer(s, msg.event as CommitRunEvent) : s,
      );
    });
  }, [requestId]);

  // After success: refresh status, then linger briefly before the file list.
  useEffect(() => {
    if (state.status !== 'success') return;
    onFinished();
    const id = setTimeout(() => setState({ status: 'idle' }), 600);
    return () => clearTimeout(id);
  }, [state.status, onFinished]);

  async function begin(message: string, allowEmpty: boolean) {
    const res = await window.electronAPI.gitCommitStart({ cwd, message, allowEmpty });
    if (!res.success || !res.data) throw new Error(res.error || 'Commit failed');
    setState(initialRunningState(res.data.requestId));
  }

  return {
    state,
    start: async (message, allowEmpty, stagedPaths) => {
      prevStagedRef.current = stagedPaths;
      lastRef.current = { message, allowEmpty };
      await begin(message, allowEmpty);
    },
    cancel: () => {
      if (requestId) void window.electronAPI.gitCommitCancel(requestId);
    },
    dismiss: () => setState({ status: 'idle' }),
    autoFixPaths: (unstaged) =>
      state.status === 'failed' ? prevStagedRef.current.filter((p) => unstaged.has(p)) : [],
    stageFixesAndRetry: async (paths) => {
      await window.electronAPI.gitStageFiles({ cwd, filePaths: paths });
      prevStagedRef.current = [...new Set([...prevStagedRef.current, ...paths])];
      try {
        await begin(lastRef.current.message, lastRef.current.allowEmpty);
      } catch (err) {
        setState({ status: 'idle' });
        throw err;
      }
    },
  };
}
