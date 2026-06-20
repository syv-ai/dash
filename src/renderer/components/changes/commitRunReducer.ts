export type HookStatus = 'Passed' | 'Failed' | 'Skipped';

export interface HookRecord {
  name: string;
  status: HookStatus;
  id?: string;
  exitCode?: number;
  duration?: number;
  modifiedFiles?: boolean;
  diagnostic: string;
}

export type CommitRunEvent =
  | { type: 'hookResult'; name: string; status: HookStatus }
  | {
      type: 'hookMeta';
      key: 'id' | 'exit' | 'duration' | 'modified';
      value: string | number | true;
    }
  | { type: 'hookDiagnostic'; text: string }
  | { type: 'rawOutput'; text: string }
  | { type: 'close'; exitCode: number | null; signal: NodeJS.Signals | null };

export type CommitRunState =
  | { status: 'idle' }
  | { status: 'running'; requestId: string; hooks: HookRecord[]; raw: string }
  | { status: 'cancelled'; hooks: HookRecord[]; raw: string }
  | { status: 'success' }
  | { status: 'failed'; hooks: HookRecord[]; raw: string };

export function initialRunningState(requestId: string): CommitRunState {
  return { status: 'running', requestId, hooks: [], raw: '' };
}

export function commitRunReducer(state: CommitRunState, event: CommitRunEvent): CommitRunState {
  if (state.status !== 'running') return state;
  switch (event.type) {
    case 'hookResult':
      return {
        ...state,
        hooks: [...state.hooks, { name: event.name, status: event.status, diagnostic: '' }],
      };
    case 'hookMeta': {
      const hooks = [...state.hooks];
      const last = hooks[hooks.length - 1];
      if (!last) return state;
      const updated: HookRecord = { ...last };
      if (event.key === 'id') updated.id = String(event.value);
      else if (event.key === 'exit') updated.exitCode = Number(event.value);
      else if (event.key === 'duration') updated.duration = Number(event.value);
      else if (event.key === 'modified') updated.modifiedFiles = true;
      hooks[hooks.length - 1] = updated;
      return { ...state, hooks };
    }
    case 'hookDiagnostic': {
      const hooks = [...state.hooks];
      const last = hooks[hooks.length - 1];
      if (!last) return state;
      hooks[hooks.length - 1] = {
        ...last,
        diagnostic: last.diagnostic ? `${last.diagnostic}\n${event.text}` : event.text,
      };
      return { ...state, hooks };
    }
    case 'rawOutput':
      return { ...state, raw: state.raw ? `${state.raw}\n${event.text}` : event.text };
    case 'close': {
      if (event.signal !== null) {
        return { status: 'cancelled', hooks: state.hooks, raw: state.raw };
      }
      const failed = state.hooks.some((h) => h.status === 'Failed');
      if (event.exitCode === 0 && !failed) return { status: 'success' };
      return { status: 'failed', hooks: state.hooks, raw: state.raw };
    }
  }
}
