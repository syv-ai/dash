import type { SystemApi } from './electron-api/system';
import type { DatabaseApi } from './electron-api/database';
import type { WorktreeApi } from './electron-api/worktree';
import type { PtyApi } from './electron-api/pty';
import type { DrawerTabsApi } from './electron-api/drawerTabs';
import type { PortsApi } from './electron-api/ports';
import type { GitApi } from './electron-api/git';
import type { ProjectSourceApi } from './electron-api/projectSource';
import type { GithubApi } from './electron-api/github';
import type { AdoApi } from './electron-api/ado';
import type { EditorApi } from './electron-api/editor';
import type { RtkApi } from './electron-api/rtk';
import type { SkillsApi } from './electron-api/skills';
import type { PluginsApi } from './electron-api/plugins';
import type { ExtensionsApi } from './electron-api/extensions';
import type { SessionApi } from './electron-api/session';
import type { TelemetryApi } from './electron-api/telemetry';
import type { AutoUpdateApi } from './electron-api/autoUpdate';

// Re-exported so existing `import type { TokenStatsUpdate } from '.../electron-api'`
// call sites keep resolving after the split.
export type { TokenStatsUpdate } from './electron-api/database';

/**
 * The full preload bridge contract (`window.electronAPI`).
 *
 * The surface is split into per-domain interfaces under `electron-api/`, one per
 * `src/main/ipc/*Ipc.ts` handler module, and composed here via `extends`. Add a
 * method to the matching domain interface — not to a flat list — so the contract
 * stays navigable as it grows.
 */
export interface ElectronAPI
  extends
    SystemApi,
    DatabaseApi,
    WorktreeApi,
    PtyApi,
    DrawerTabsApi,
    PortsApi,
    GitApi,
    ProjectSourceApi,
    GithubApi,
    AdoApi,
    EditorApi,
    RtkApi,
    SkillsApi,
    PluginsApi,
    ExtensionsApi,
    SessionApi,
    TelemetryApi,
    AutoUpdateApi {}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
