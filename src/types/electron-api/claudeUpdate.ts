import type { ClaudeUpdateMode, ClaudeUpdateState, IpcResponse } from '../../shared/types';

/**
 * A Claude Code update that live task sessions don't run yet. Main broadcasts
 * the whole state on `claudeUpdate:state`; the renderer asks for a restart
 * (now, or once every task is done) or cancels a pending one.
 */
export interface ClaudeUpdateApi {
  claudeUpdateGetState: () => Promise<IpcResponse<ClaudeUpdateState>>;
  claudeUpdateRestart: (mode: ClaudeUpdateMode) => Promise<IpcResponse<void>>;
  claudeUpdateCancel: () => Promise<IpcResponse<void>>;
  onClaudeUpdateState: (callback: (state: ClaudeUpdateState) => void) => () => void;
}
