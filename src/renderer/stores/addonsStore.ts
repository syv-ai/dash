import { create } from 'zustand';
import { toast } from 'sonner';
import type { SurfaceRef } from '@shared/addon-api';
import type { AddonListItem, AddonSurfaceSet } from '@shared/addons';

/**
 * Renderer cache of what the add-on host (main) reports: the add-on list and
 * each add-on's evaluated surfaces, for the active task and for Settings.
 * Holds no add-on state of its own — every change re-fetches from main, so a
 * reload just loads again. Drawer side and collapse state live in settingsStore.
 */
interface AddonsState {
  list: AddonListItem[];
  /** Surfaces for `taskId` (drawers). */
  taskId: string | null;
  taskSurfaces: AddonSurfaceSet[];
  /** Surfaces with no task (settings sections). */
  settingsSurfaces: AddonSurfaceSet[];

  load: () => Promise<void>;
  setTask: (taskId: string | null) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  action: (addonId: string, ref: SurfaceRef, actionId: string) => Promise<void>;
  /** Subscribe to host events; returns the unsubscribe. */
  init: () => () => void;
}

async function fetchSurfaces(taskId: string | null): Promise<AddonSurfaceSet[]> {
  const resp = await window.electronAPI.addonsSurfaces({ taskId });
  return resp.success && resp.data ? resp.data : [];
}

export const useAddons = create<AddonsState>()((set, get) => ({
  list: [],
  taskId: null,
  taskSurfaces: [],
  settingsSurfaces: [],

  load: async () => {
    const taskId = get().taskId;
    const [listResp, taskSurfaces, settingsSurfaces] = await Promise.all([
      window.electronAPI.addonsList(),
      taskId ? fetchSurfaces(taskId) : Promise.resolve([]),
      fetchSurfaces(null),
    ]);
    // A task switch during the fetch wins; its own load sets taskSurfaces.
    if (get().taskId !== taskId) {
      set({
        list: listResp.success && listResp.data ? listResp.data : get().list,
        settingsSurfaces,
      });
      return;
    }
    set({
      list: listResp.success && listResp.data ? listResp.data : get().list,
      taskSurfaces,
      settingsSurfaces,
    });
  },

  setTask: async (taskId) => {
    set({ taskId, taskSurfaces: taskId === get().taskId ? get().taskSurfaces : [] });
    if (!taskId) return;
    const surfaces = await fetchSurfaces(taskId);
    if (get().taskId === taskId) set({ taskSurfaces: surfaces });
  },

  setEnabled: async (id, enabled) => {
    const resp = await window.electronAPI.addonsSetEnabled({ id, enabled });
    if (!resp.success) toast.error(resp.error ?? `Couldn't update ${id}`);
    await get().load();
  },

  action: async (addonId, ref, actionId) => {
    const resp = await window.electronAPI.addonsAction({ addonId, ref, actionId });
    if (!resp.success) toast.error(resp.error ?? 'Action failed');
  },

  init: () => {
    void get().load();
    const offChanged = window.electronAPI.onAddonsChanged(() => {
      void get().load();
    });
    const offToast = window.electronAPI.onAddonsToast(({ kind, title, body }) => {
      toast[kind](title, body ? { description: body } : undefined);
    });
    return () => {
      offChanged();
      offToast();
    };
  },
}));
