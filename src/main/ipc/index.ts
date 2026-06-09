import { registerAppIpc } from './appIpc';
import { registerDbIpc } from './dbIpc';
import { registerWorktreeIpc } from './worktreeIpc';
import { registerPtyIpc } from './ptyIpc';
import { registerGitIpc } from './gitIpc';
import { registerGithubIpc } from './githubIpc';
import { registerAutoUpdateIpc } from './autoUpdateIpc';
import { registerAzureDevOpsIpc } from './azureDevOpsIpc';
import { registerRtkIpc } from './rtkIpc';
import { registerTelemetryIpc } from './telemetryIpc';
import { registerSkillsIpc } from './skillsIpc';
import { registerSessionIpc } from './sessionIpc';
import { registerEditorIpc } from './editorIpc';
import { registerDiffCommentsIpc } from './diffCommentsIpc';
import { registerTokenStatsIpc } from './tokenStatsIpc';
import { registerPortsIpc } from './portsIpc';
import { registerDrawerTabsIpc } from './drawerTabsIpc';

export function registerAllIpc(): void {
  registerAppIpc();
  registerDbIpc();
  registerWorktreeIpc();
  registerPtyIpc();
  registerGitIpc();
  registerGithubIpc();
  registerAutoUpdateIpc();
  registerAzureDevOpsIpc();
  registerRtkIpc();
  registerTelemetryIpc();
  registerSkillsIpc();
  registerSessionIpc();
  registerEditorIpc();
  registerDiffCommentsIpc();
  registerTokenStatsIpc();
  registerPortsIpc();
  registerDrawerTabsIpc();
}
