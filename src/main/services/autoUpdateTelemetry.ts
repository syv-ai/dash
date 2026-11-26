import type { AutoUpdateState } from '@shared/types';
import type { TelemetryEvent } from './activityTelemetry';

/** electron-updater's codes (`ERR_UPDATER_…`) and Node's (`ENOTFOUND`); a path or message never passes. */
const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.:-]{0,47}$/;

/** An error's `code` when it is identifier-shaped, else `unknown`. */
export function updateErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : 'unknown';
}

/** Where in the update a failure happened, from the status it failed in. */
function stageOf(state: AutoUpdateState): 'check' | 'download' | 'install' {
  if (state === 'downloading' || state === 'available') return 'download';
  if (state === 'ready') return 'install';
  return 'check';
}

/**
 * Dash's own update as analytics (docs/telemetry.md): an update found and
 * downloaded once per version per run (electron-updater announces it again on
 * every check after a restart), a failure once per stage and code. Pure.
 */
export class UpdateTelemetry {
  private readonly sent = new Set<string>();

  constructor(private readonly currentVersion: string) {}

  available(toVersion: string): TelemetryEvent | null {
    return this.once(`available:${toVersion}`, 'app_update_available', { to_version: toVersion });
  }

  downloaded(toVersion: string | null): TelemetryEvent | null {
    return this.once(`downloaded:${toVersion}`, 'app_update_downloaded', versionProp(toVersion));
  }

  /** `state` is the status the failure happened in (before it is folded in). */
  failed(state: AutoUpdateState, err: unknown, toVersion: string | null): TelemetryEvent | null {
    const stage = stageOf(state);
    const code = updateErrorCode(err);
    return this.once(`failed:${stage}:${code}`, 'app_update_failed', {
      stage,
      error_code: code,
      ...versionProp(toVersion),
    });
  }

  private once(
    key: string,
    event: string,
    properties: TelemetryEvent['properties'],
  ): TelemetryEvent | null {
    if (this.sent.has(key)) return null;
    this.sent.add(key);
    return { event, properties: { ...properties, from_version: this.currentVersion } };
  }
}

const versionProp = (v: string | null): TelemetryEvent['properties'] =>
  v ? { to_version: v } : {};

/** A launch on another version than the last one (the update took). */
export function installedUpdate(
  lastVersion: string | undefined,
  currentVersion: string,
): TelemetryEvent | null {
  if (!lastVersion || lastVersion === currentVersion) return null;
  return {
    event: 'app_update_installed',
    properties: { from_version: lastVersion, to_version: currentVersion },
  };
}
