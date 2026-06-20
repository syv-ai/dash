import type {
  IpcResponse,
  ExtensionsOverview,
  ExtensionScopeInput,
  SetSkillOverrideArgs,
  PluginComponents,
  ComponentDetail,
  SkillDetail,
  GetPluginComponentsArgs,
  GetPluginComponentDetailArgs,
  GetSkillDetailArgs,
  SkillRef,
} from '../../shared/types';

/** Unified Extensions surface (skills + plugins) backing the Extensions modal. */
export interface ExtensionsApi {
  extensionsGetOverview: (args: ExtensionScopeInput) => Promise<IpcResponse<ExtensionsOverview>>;
  extensionsSetSkillOverride: (args: SetSkillOverrideArgs) => Promise<IpcResponse<void>>;
  extensionsGetPluginComponents: (
    args: GetPluginComponentsArgs,
  ) => Promise<IpcResponse<PluginComponents>>;
  extensionsGetPluginComponentDetail: (
    args: GetPluginComponentDetailArgs,
  ) => Promise<IpcResponse<ComponentDetail>>;
  extensionsGetSkillDetail: (args: GetSkillDetailArgs) => Promise<IpcResponse<SkillDetail>>;
  extensionsGetRegistrySkillDetail: (args: SkillRef) => Promise<IpcResponse<SkillDetail>>;
}
