import type { IpcResponse, AzureDevOpsWorkItem, AzureDevOpsConfig } from '../../shared/types';

/** Azure DevOps work-item search/linking and config. PRs go through `PrReviewApi`. */
export interface AdoApi {
  adoCheckConfigured: (projectId?: string) => Promise<IpcResponse<boolean>>;
  adoTestConnection: (config: AzureDevOpsConfig) => Promise<IpcResponse<boolean>>;
  adoSaveConfig: (config: AzureDevOpsConfig, projectId?: string) => Promise<IpcResponse<void>>;
  adoGetConfig: (projectId?: string) => Promise<IpcResponse<AzureDevOpsConfig | null>>;
  adoRemoveConfig: (projectId?: string) => Promise<IpcResponse<void>>;
  adoSearchWorkItems: (
    query: string,
    projectId?: string,
  ) => Promise<IpcResponse<AzureDevOpsWorkItem[]>>;
  adoGetWorkItem: (id: number, projectId?: string) => Promise<IpcResponse<AzureDevOpsWorkItem>>;
  adoPostBranchComment: (
    workItemId: number,
    branch: string,
    projectId?: string,
  ) => Promise<IpcResponse<void>>;
}
