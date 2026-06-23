// Logic for the "what's new" toast shown on the first launch after an update.
// Pure and dependency-free so it can be unit-tested under the node runner.

const RELEASE_TAG_BASE = 'https://github.com/syv-ai/dash/releases/tag';

/** Parse a version into [major, minor, patch]. Tolerates a leading `v`, a
 *  pre-release/build suffix (`-beta.1`, `+build`), and the dev `.DEV` marker
 *  (a 4th dotted segment, simply ignored). Missing or non-numeric parts → 0. */
function parseVersion(version: string): [number, number, number] {
  const core = version.replace(/^v/i, '').split(/[-+]/)[0]!;
  const parts = core.split('.');
  const at = (i: number) => {
    const n = parseInt(parts[i] ?? '', 10);
    return Number.isNaN(n) ? 0 : n;
  };
  return [at(0), at(1), at(2)];
}

/** The clean `major.minor.patch` form, dropping any `v` prefix or suffix. */
export function normalizeVersion(version: string): string {
  const [major, minor, patch] = parseVersion(version);
  return `${major}.${minor}.${patch}`;
}

/** -1 / 0 / 1 by semantic precedence of the numeric core (suffixes ignored). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! > pb[i]!) return 1;
    if (pa[i]! < pb[i]!) return -1;
  }
  return 0;
}

/** Whether to surface the release-notes toast: only when `current` is strictly
 *  newer than the last version the user was shown. An unset `lastSeen` (fresh
 *  install) returns false — the caller catches up silently so first launches
 *  stay quiet; a downgrade (e.g. running a dev build) also stays quiet. */
export function shouldShowReleaseNotes(current: string, lastSeen: string | undefined): boolean {
  if (!lastSeen) return false;
  return compareVersions(current, lastSeen) === 1;
}

/** GitHub release page for a version, e.g. `…/releases/tag/v0.13.0`. */
export function releaseUrl(version: string): string {
  return `${RELEASE_TAG_BASE}/v${normalizeVersion(version)}`;
}
