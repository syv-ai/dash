import type { StorageLike } from './fanOutStorage';
import { SETTINGS_REGISTRY } from './settingsKeys';

/** The stored settings' schema: how many of SCHEMA_STEPS have run on them. */
export const SCHEMA_KEY = 'settingsSchema';

/**
 * Steps that run once, in order, on an install whose schema is older. A step
 * that changes a default writes the old one for an install that had it from
 * before (`existing`), so nobody's look or behaviour changes under them; a
 * new install (no setting stored yet) gets the new default.
 */
const SCHEMA_STEPS: Array<(backing: StorageLike, existing: boolean) => void> = [
  // 1. The theme's default went from Dark to System.
  (backing, existing) => {
    if (existing && backing.getItem('theme') === null) backing.setItem('theme', 'dark');
  },
];

/** An install that stored a setting before: one of the registry's keys is there. */
function isExistingInstall(backing: StorageLike): boolean {
  return SETTINGS_REGISTRY.some((e) => backing.getItem(e.key) !== null);
}

/** One-shot, idempotent rewrites of legacy localStorage values, run once before
 *  the settings store hydrates. Keep each migration cheap and self-checking. */
export function runSettingsMigrations(backing: StorageLike): void {
  // Legacy IDE id 'code' was renamed to 'vscode'. Rewrite eagerly so external
  // readers (lib/openInIde.ts) that read the raw key see the new value.
  if (backing.getItem('preferredIDE') === 'code') {
    backing.setItem('preferredIDE', 'vscode');
  }
  // "Terminals kept ready" counted WebGL contexts (webglHeldLimit, default 8);
  // it now counts whole terminals, attach clients included (D59), so the old
  // value doesn't carry over: everyone starts on the new default.
  backing.removeItem('webglHeldLimit');

  const from = Number(backing.getItem(SCHEMA_KEY) ?? 0) || 0;
  if (from >= SCHEMA_STEPS.length) return;
  const existing = isExistingInstall(backing);
  for (const step of SCHEMA_STEPS.slice(from)) step(backing, existing);
  backing.setItem(SCHEMA_KEY, String(SCHEMA_STEPS.length));
}
