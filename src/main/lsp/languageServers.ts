import { webContents } from 'electron';
import { broadcast } from '../utils/broadcast';
import { LanguageServerManager } from './LanguageServerManager';
import { TelemetryService } from '../services/TelemetryService';

/**
 * The app's one LanguageServerManager: diagnostics go to the renderer that
 * opened the document, status changes to every window. Task lifecycle
 * (`TaskService`) and quit (`main.ts`) stop servers through it.
 */
export const languageServers = new LanguageServerManager({
  onDiagnostics: (owner, event) => {
    const target = webContents.fromId(owner);
    if (target && !target.isDestroyed()) target.send('lsp:diagnostics', event);
  },
  onStatus: (worktree, servers) => broadcast('lsp:status', { worktree, servers }),
  onFailed: (serverId) => TelemetryService.capture('lsp_failed', { language_id: serverId }),
});

// Quit normally awaits `shutdownAll()`; this catches a forced exit so no server outlives Dash.
process.once('exit', () => languageServers.killAll());
