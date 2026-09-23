import type { IpcResponse } from '../../shared/types';
import type { SurfaceRef } from '../../shared/addon-api';
import type { AddonListItem, AddonSurfaceSet } from '../../shared/addons';

/** Add-ons (src/main/addons): list, enable, surfaces, actions and host events. */
export interface AddonsApi {
  addonsList: () => Promise<IpcResponse<AddonListItem[]>>;
  addonsSetEnabled: (args: { id: string; enabled: boolean }) => Promise<IpcResponse<void>>;
  addonsSurfaces: (args: { taskId: string | null }) => Promise<IpcResponse<AddonSurfaceSet[]>>;
  addonsAction: (args: {
    addonId: string;
    ref: SurfaceRef;
    actionId: string;
  }) => Promise<IpcResponse<void>>;
  addonsTerminalClosed: (args: { taskId: string; tabId: string }) => Promise<IpcResponse<void>>;
  onAddonsChanged: (callback: (data: { addonId: string }) => void) => () => void;
  onAddonsEnvChanged: (callback: (data: { addonId: string }) => void) => () => void;
  onAddonsTaskCreated: (
    callback: (data: { taskId: string; projectId: string }) => void,
  ) => () => void;
  onAddonsActivateTask: (
    callback: (data: { taskId: string; projectId: string }) => void,
  ) => () => void;
  onAddonsRestartTask: (callback: (taskId: string) => void) => () => void;
  onAddonsFocusTab: (
    callback: (data: { taskId: string; tabId: string; reset: boolean }) => void,
  ) => () => void;
  onAddonsToast: (
    callback: (data: {
      kind: 'info' | 'success' | 'warning' | 'error';
      title: string;
      body?: string;
    }) => void,
  ) => () => void;
}
