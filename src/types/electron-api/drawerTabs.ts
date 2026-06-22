import type { IpcResponse } from '../../shared/types';
import type { Tab, AddTabOpts, BulkUpsertEntry } from '../../shared/drawerTabs';

/** Per-task drawer tab state, owned by the main process. */
export interface DrawerTabsApi {
  drawerTabsList: (taskId: string) => Promise<IpcResponse<Tab[]>>;
  drawerTabsGetActive: (taskId: string) => Promise<IpcResponse<string | null>>;
  drawerTabsAdd: (taskId: string, opts: AddTabOpts) => Promise<IpcResponse<Tab>>;
  drawerTabsClose: (tabId: string) => Promise<IpcResponse<void>>;
  drawerTabsSetActive: (taskId: string, tabId: string) => Promise<IpcResponse<void>>;
  drawerTabsBulkUpsert: (entries: BulkUpsertEntry[]) => Promise<IpcResponse<void>>;
  drawerTabsSubscribe: (taskId: string) => Promise<IpcResponse<void>>;
  drawerTabsUnsubscribe: (taskId: string) => Promise<IpcResponse<void>>;
  onDrawerTabsChanged: (cb: (taskId: string) => void) => () => void;
}
