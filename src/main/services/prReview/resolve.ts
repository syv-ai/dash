import type { AzureDevOpsConfig, PrProvider, Project } from '@shared/types';
import { parseAdoRemote, providerForRemote } from '@shared/urls';
import { githubProvider } from './github';
import { adoProvider } from './ado';
import type { PrContext, ForgeProvider } from './types';

/** Lookups the resolver needs; the IPC layer passes the app's (DatabaseService, ConnectionConfigService). */
export interface PrContextDeps {
  getProject(id: string): Project | undefined;
  getAdoConfig(projectId: string): AzureDevOpsConfig | null;
}

const adapters: Record<PrProvider, ForgeProvider> = { github: githubProvider, ado: adoProvider };

/** The provider a project's PRs live on, from its remote; null without a
 *  remote or on a forge Dash has no provider for. The one place that's decided. */
export function prProviderFor(project: Pick<Project, 'gitRemote'>): PrProvider | null {
  return providerForRemote(project.gitRemote ?? null);
}

/** A project whose PRs Dash can't reach: no remote, or a forge it has no provider for. */
export class UnsupportedForgeError extends Error {
  constructor() {
    super("This project's remote isn't on GitHub or Azure DevOps");
    this.name = 'UnsupportedForgeError';
  }
}

/** The adapter of the forge a remote is on, for what needs only the checkout
 *  (no project, so no ADO credentials). */
export function forgeForRemote(remote: string | null): ForgeProvider | null {
  const provider = providerForRemote(remote);
  return provider ? adapters[provider] : null;
}

/** The provider a project's PRs live on, its adapter, and the context to call it with. */
export function prContextFor(
  projectId: string,
  cwd: string,
  deps: PrContextDeps,
): { provider: PrProvider; adapter: ForgeProvider; ctx: PrContext } {
  const project = deps.getProject(projectId);
  if (!project) throw new Error('Unknown project');
  const remote = project.gitRemote ?? null;
  const provider = prProviderFor(project);
  if (!provider) throw new UnsupportedForgeError();
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
