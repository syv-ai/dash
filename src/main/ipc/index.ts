import { ipcMain } from 'electron';
import { TelemetryService } from '../services/TelemetryService';
import { instrumentIpcHandlers } from './instrumentIpc';
import { registerAppIpc } from './appIpc';
import { registerDbIpc } from './dbIpc';
import { registerTaskIpc } from './taskIpc';
import { registerWorktreeIpc } from './worktreeIpc';
import { registerPtyIpc } from './ptyIpc';
import { registerGitIpc } from './gitIpc';
import { registerGithubIpc } from './githubIpc';
import { registerAutoUpdateIpc } from './autoUpdateIpc';
import { registerClaudeUpdateIpc } from './claudeUpdateIpc';
import { registerAzureDevOpsIpc } from './azureDevOpsIpc';
import { registerRtkIpc } from './rtkIpc';
import { registerTelemetryIpc } from './telemetryIpc';
import { registerSessionIpc } from './sessionIpc';
import { registerEditorIpc } from './editorIpc';
import { registerDiffCommentsIpc } from './diffCommentsIpc';
import { registerPrReviewIpc } from './prReviewIpc';
import { registerTokenStatsIpc } from './tokenStatsIpc';
import { registerPortsIpc } from './portsIpc';
import { registerDrawerTabsIpc } from './drawerTabsIpc';
import { registerWorkspaceConfigIpc } from './workspaceConfigIpc';
import { registerProjectSourceIpc } from './projectSourceIpc';
import { registerMemoryIpc } from './memoryIpc';
import { registerLspIpc } from './lspIpc';

export function registerAllIpc(): void {
  // First, so every handler below reports its failures (docs/telemetry.md).
  instrumentIpcHandlers(ipcMain, {
    failure: (channel, code) => TelemetryService.captureIpcFailure(channel, code),
    exception: (err, channel) => TelemetryService.captureException(err, { source: 'ipc', channel }),
  });
  registerAppIpc();
  registerDbIpc();
  registerTaskIpc();
  registerWorktreeIpc();
  registerPtyIpc();
  registerGitIpc();
  registerGithubIpc();
  registerAutoUpdateIpc();
  registerClaudeUpdateIpc();
  registerAzureDevOpsIpc();
  registerRtkIpc();
  registerTelemetryIpc();
  registerSessionIpc();
  registerEditorIpc();
  registerDiffCommentsIpc();
  registerPrReviewIpc();
  registerTokenStatsIpc();
  registerPortsIpc();
  registerDrawerTabsIpc();
  registerWorkspaceConfigIpc();
  registerProjectSourceIpc();
  registerMemoryIpc();
  registerLspIpc();
}
