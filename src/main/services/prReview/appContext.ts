import { DatabaseService } from '../DatabaseService';
import { ConnectionConfigService } from '../ConnectionConfigService';
import type { PrContextDeps } from './resolve';

/** The app's lookups for picking a project's PR provider: its database and connection config. */
export const appPrContextDeps: PrContextDeps = {
  getProject: (id) => DatabaseService.getProjects().find((p) => p.id === id),
  getAdoConfig: (projectId) => ConnectionConfigService.getAdoConfig(projectId),
};
