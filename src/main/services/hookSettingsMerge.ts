/**
 * Pure helpers for the settings.local.json merge — extracted so tests can
 * exercise the user-content-preservation invariant without dragging in the
 * full ptyManager dependency graph (DB, hookServer, native modules).
 */

export type HttpHook = { type: 'http'; url: string; async?: boolean };
export type CommandHook = { type: 'command'; command: string };
export type Hook = (HttpHook | CommandHook) & { __dash?: true };
export type HookEntry = { matcher: string; hooks: Hook[] };

/**
 * All hook event names Dash writes to settings.local.json. Used to decide
 * which existing entries are candidates for replacement vs. preservation.
 */
export const DASH_HOOK_EVENTS = [
  'Stop',
  'UserPromptSubmit',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'StopFailure',
  'PreCompact',
  'PostCompact',
  'SessionStart',
] as const;

/**
 * Recognise a Dash-authored hook entry. Primary signal is the explicit
 * `__dash: true` brand. URL-prefix matching is a fallback for the rare case
 * where a round-trip through another tool stripped the unknown field — without
 * it, every refresh would append a duplicate of every Dash hook.
 *
 * `dashHookUrlPrefix` is injected (rather than read from the live hookServer
 * port) so this module stays pure and easy to test.
 */
export function isDashOwnedHook(h: unknown, dashHookUrlPrefix: string | null): boolean {
  if (!h || typeof h !== 'object') return false;
  if ((h as { __dash?: unknown }).__dash === true) return true;
  if (dashHookUrlPrefix) {
    const url = (h as { url?: unknown }).url;
    if (typeof url === 'string' && url.startsWith(dashHookUrlPrefix)) return true;
  }
  return false;
}

export function entryIsDashOwned(entry: unknown, dashHookUrlPrefix: string | null): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const hooks = (entry as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => isDashOwnedHook(h, dashHookUrlPrefix));
}

/**
 * Merge existing hook entries with Dash-owned entries, preserving user-
 * authored content verbatim:
 * - For events Dash manages: drop Dash-owned entries (they get rewritten),
 *   keep user-authored ones.
 * - For events Dash doesn't touch: pass through unchanged.
 * - Then append the fresh Dash entries.
 */
export function mergeHookEntries(
  existing: Record<string, HookEntry[] | undefined>,
  dash: Record<string, HookEntry[]>,
  dashHookUrlPrefix: string | null,
): Record<string, HookEntry[]> {
  const merged: Record<string, HookEntry[]> = {};
  const dashEventSet = new Set<string>(DASH_HOOK_EVENTS);
  for (const [event, userEntries] of Object.entries(existing)) {
    if (!Array.isArray(userEntries)) continue;
    merged[event] = dashEventSet.has(event)
      ? userEntries.filter((e) => !entryIsDashOwned(e, dashHookUrlPrefix))
      : userEntries;
  }
  for (const [event, entries] of Object.entries(dash)) {
    const preserved = merged[event] ?? [];
    merged[event] = [...preserved, ...entries];
  }
  return merged;
}
