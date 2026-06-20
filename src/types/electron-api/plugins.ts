import type {
  IpcResponse,
  PluginsOverview,
  AddMarketplaceArgs,
  RemoveMarketplaceArgs,
  PluginInstallArgs,
  PluginUninstallArgs,
  PluginSetEnabledArgs,
} from '../../shared/types';

/** Claude Code native plugin manager. Mutating calls return the refreshed overview
 *  so the renderer can update without a second round-trip. */
export interface PluginsApi {
  pluginsGetOverview: () => Promise<IpcResponse<PluginsOverview>>;
  pluginsAddMarketplace: (args: AddMarketplaceArgs) => Promise<IpcResponse<PluginsOverview>>;
  pluginsRemoveMarketplace: (args: RemoveMarketplaceArgs) => Promise<IpcResponse<PluginsOverview>>;
  pluginsUpdateMarketplace: (args?: { name?: string }) => Promise<IpcResponse<PluginsOverview>>;
  pluginsInstall: (args: PluginInstallArgs) => Promise<IpcResponse<PluginsOverview>>;
  pluginsUninstall: (args: PluginUninstallArgs) => Promise<IpcResponse<PluginsOverview>>;
  pluginsSetEnabled: (args: PluginSetEnabledArgs) => Promise<IpcResponse<PluginsOverview>>;
}
