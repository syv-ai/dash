import { app } from 'electron';
import { ADDONS } from '../addons';
import { getRawDb } from '../db/client';
import { DatabaseService } from '../services/DatabaseService';
import { AddonHost } from './AddonHost';
import { createAddonStore, importLegacyAddonSettings, type AddonStore } from './addonStore';
import { createHostDeps } from './hostDeps';

// The one place core wires the add-on list to the host. Nothing else outside
// src/main/addons imports an add-on.

let host: AddonHost | null = null;
let store: AddonStore | null = null;

export function getAddonStore(): AddonStore {
  if (!store) {
    const db = getRawDb();
    if (!db) throw new Error('Database not initialized');
    store = createAddonStore(db);
  }
  return store;
}

/**
 * Add-on env and PATH dirs for a PTY running in `cwd` (a worktree or project
 * dir). Called by core wherever it builds a Claude or shell env.
 */
export function addonSessionEnv(cwd: string | undefined): {
  env: Record<string, string>;
  pathDirs: string[];
} {
  if (!host) return { env: {}, pathDirs: [] };
  const taskId = cwd ? (DatabaseService.getTaskByPath(cwd)?.id ?? null) : null;
  return {
    env: cwd ? host.envFor({ path: cwd, taskId }) : {},
    pathDirs: host.pathDirs(),
  };
}

/** The host if it has been created (boot), else null — for code that also runs in tests. */
export function peekAddonHost(): AddonHost | null {
  return host;
}

export function getAddonHost(): AddonHost {
  if (!host) {
    importLegacyAddonSettings(getAddonStore(), app.getPath('userData'));
    const deps = createHostDeps(getAddonStore(), () => getAddonHost());
    host = new AddonHost(ADDONS, deps);
  }
  return host;
}
