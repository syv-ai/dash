import type { StorageLike } from './fanOutStorage';

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
}
