import { ipcMain, BrowserWindow } from 'electron';
import { DrawerTabsService } from '../services/DrawerTabsService';
import { getRawDb } from '../db/client';
import type { AddTabOpts, BulkUpsertEntry } from '../../shared/drawerTabs';

let service: DrawerTabsService | null = null;

export function initDrawerTabsService(): DrawerTabsService {
  if (!service) {
    const db = getRawDb();
    if (!db) throw new Error('Database not initialized');
    service = new DrawerTabsService(db);
  }
  return service;
}

export function registerDrawerTabsIpc(): void {
  const svc = initDrawerTabsService();

  ipcMain.handle('drawerTabs:list', (_e, taskId: string) => ({
    success: true as const,
    data: svc.list(taskId),
  }));

  ipcMain.handle('drawerTabs:getActive', (_e, taskId: string) => ({
    success: true as const,
    data: svc.getActive(taskId),
  }));

  ipcMain.handle('drawerTabs:add', (_e, taskId: string, opts: AddTabOpts) => ({
    success: true as const,
    data: svc.add(taskId, opts),
  }));

  ipcMain.handle('drawerTabs:close', (_e, tabId: string) => {
    svc.close(tabId);
    return { success: true as const };
  });

  ipcMain.handle('drawerTabs:setActive', (_e, taskId: string, tabId: string) => {
    svc.setActive(taskId, tabId);
    return { success: true as const };
  });

  ipcMain.handle('drawerTabs:bulkUpsert', (_e, entries: BulkUpsertEntry[]) => {
    svc.bulkUpsert(entries);
    return { success: true as const };
  });

  // Push-channel: renderer calls drawerTabs:subscribe(taskId); main forwards
  // every onChange for that task back as 'drawerTabs:changed'. Multiple
  // BrowserWindows / WebContents may subscribe simultaneously.
  const subscriptions = new Map<string, () => void>(); // key = `${webContentsId}:${taskId}`

  ipcMain.handle('drawerTabs:subscribe', (e, taskId: string) => {
    const key = `${e.sender.id}:${taskId}`;
    if (subscriptions.has(key)) return { success: true as const };
    const win = BrowserWindow.fromWebContents(e.sender);
    const unsub = svc.onChange(taskId, (tid) => {
      if (win && !win.isDestroyed()) e.sender.send('drawerTabs:changed', tid);
    });
    subscriptions.set(key, unsub);
    return { success: true as const };
  });

  ipcMain.handle('drawerTabs:unsubscribe', (e, taskId: string) => {
    const key = `${e.sender.id}:${taskId}`;
    const unsub = subscriptions.get(key);
    if (unsub) {
      unsub();
      subscriptions.delete(key);
    }
    return { success: true as const };
  });
}
