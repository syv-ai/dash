import { app } from 'electron';
import path from 'path';
import { SidecarTuiHost } from './SidecarTuiHost';
import { initDrawerTabsService } from '../ipc/drawerTabsIpc';
import { startCommandPty, killPty } from '../services/ptyManager';

let host: SidecarTuiHost | null = null;

/**
 * Lazy singleton so importing modules (tuiIpc, feature registrations) don't
 * touch `app` paths before Electron is ready. NB: app.getAppPath() lies in
 * dev — __dirname-based resolution is the documented pattern (CLAUDE.md /
 * docs/state.md critical knowledge §2).
 */
export function getTuiHost(): SidecarTuiHost {
  if (!host) {
    host = new SidecarTuiHost({
      socketDir: path.join(app.getPath('userData'), 'sockets'),
      scriptPath: path
        .join(__dirname, '..', 'scripts', 'tui.js')
        .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`),
      drawerTabs: {
        add: (taskId, opts) => initDrawerTabsService().add(taskId, opts as never),
        close: (tabId) => initDrawerTabsService().close(tabId),
        setActive: (taskId, tabId) => initDrawerTabsService().setActive(taskId, tabId),
      },
      startPty: (opts) => startCommandPty(opts as never),
      killPty: (id) => killPty(id),
    });
  }
  return host;
}
