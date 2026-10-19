import type { AzureDevOpsConfig, PrProvider, Project } from '@shared/types';
import { parseAdoRemote, providerForRemote } from '@shared/urls';
import { githubProvider } from './github';
import { adoProvider } from './ado';
import type { PrContext, PrReviewProvider } from './types';

/** Lookups the resolver needs; the IPC layer passes the app's (DatabaseService, ConnectionConfigService). */
export interface PrContextDeps {
  getProject(id: string): Project | undefined;
  getAdoConfig(projectId: string): AzureDevOpsConfig | null;
}

const adapters: Record<PrProvider, PrReviewProvider> = { github: githubProvider, ado: adoProvider };

/** The provider a project's PRs live on, its adapter, and the context to call it with. */
export function prContextFor(
  projectId: string,
  cwd: string,
  deps: PrContextDeps,
): { provider: PrProvider; adapter: PrReviewProvider; ctx: PrContext } {
  const project = deps.getProject(projectId);
  if (!project) throw new Error('Unknown project');
  const remote = project.gitRemote ?? null;
  const provider = providerForRemote(remote);
  const ctx: PrContext = { cwd, projectId, remote };
  if (provider === 'ado') {
    const config = deps.getAdoConfig(projectId);
    if (!config) throw new Error('Azure DevOps not configured');
    const repository = remote ? parseAdoRemote(remote)?.repository : undefined;
    if (!repository) throw new Error('Could not determine repository from remote');
    ctx.ado = { ...config, repository };
  }
  return { provider, adapter: adapters[provider], ctx };
}
