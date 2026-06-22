import type {
  IpcResponse,
  SkillsSearchResult,
  SkillInstallStatus,
  SkillRef,
  SkillInstallArgs,
  SkillInstallTarget,
  SkillUninstallArgs,
  SkillsSearchArgs,
  SkillsRegistryMeta,
  InstalledSkillsResult,
} from '../../shared/types';

/** Skills registry: refresh/search/read and install/uninstall against probe paths. */
export interface SkillsApi {
  skillsRefresh: (args?: { force?: boolean }) => Promise<IpcResponse<SkillsRegistryMeta>>;
  skillsGetMeta: () => Promise<IpcResponse<SkillsRegistryMeta>>;
  skillsGetCategories: () => Promise<IpcResponse<string[]>>;
  skillsSearch: (args: SkillsSearchArgs) => Promise<IpcResponse<SkillsSearchResult>>;
  skillsGetContent: (args: SkillRef) => Promise<IpcResponse<string>>;
  skillsReadLocalSkillMd: (args: {
    skillName: string;
    target: SkillInstallTarget;
  }) => Promise<IpcResponse<string>>;
  skillsInstall: (args: SkillInstallArgs) => Promise<IpcResponse<void>>;
  skillsCheckInstalled: (args: {
    skillName: string;
    probePaths: string[];
    /** Provide for registry skills so the marker file is checked; omit for legacy
     *  presence-only checks. */
    ref?: SkillRef | null;
  }) => Promise<IpcResponse<SkillInstallStatus>>;
  skillsListInstalled: (args: {
    probePaths: string[];
  }) => Promise<IpcResponse<InstalledSkillsResult>>;
  skillsUninstall: (args: SkillUninstallArgs) => Promise<IpcResponse<void>>;
  skillsResetCache: () => Promise<IpcResponse<SkillsRegistryMeta>>;
}
