import { create } from 'zustand';
import type { LspServerStatus, LspStatusEvent } from '../../shared/lsp';

interface LspStatusState {
  /** Per worktree path, the language servers main runs for it. */
  byWorktree: Record<string, LspServerStatus[]>;
  apply(event: LspStatusEvent): void;
}

export const useLspStatus = create<LspStatusState>((set) => ({
  byWorktree: {},
  apply: (event) =>
    set((s) => ({ byWorktree: { ...s.byWorktree, [event.worktree]: event.servers } })),
}));

/** Follow main's status pushes (once, for the window's lifetime). */
export function startLspStatusFeed(): () => void {
  return window.electronAPI.onLspStatus((event) => useLspStatus.getState().apply(event));
}

/** Ask main for a worktree's servers (a push only comes on a change). */
export async function refreshLspStatus(worktree: string): Promise<void> {
  const resp = await window.electronAPI.lspStatus({ worktree });
  if (resp.success && resp.data) useLspStatus.getState().apply(resp.data);
}
