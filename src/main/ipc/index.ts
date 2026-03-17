import { registerAppIpc } from './appIpc';
import { registerDbIpc } from './dbIpc';
import { registerWorktreeIpc } from './worktreeIpc';
import { registerPtyIpc } from './ptyIpc';
import { registerGitIpc } from './gitIpc';
import { registerGithubIpc } from './githubIpc';
import { registerAutoUpdateIpc } from './autoUpdateIpc';
import { registerAzureDevOpsIpc } from './azureDevOpsIpc';
import { registerPixelAgentsIpc } from './pixelAgentsIpc';

export function registerAllIpc(): void {
  registerAppIpc();
  registerDbIpc();
  registerWorktreeIpc();
  registerPtyIpc();
  registerGitIpc();
  registerGithubIpc();
  registerAutoUpdateIpc();
  registerAzureDevOpsIpc();
  registerPixelAgentsIpc();
}
