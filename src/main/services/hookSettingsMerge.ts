/**
 * Pure helpers for the settings.local.json merge — extracted so tests can
 * exercise the user-content-preservation invariant without dragging in the
 * full ptyManager dependency graph (DB, hookServer, native modules).
 *
 * Single source of truth: the two `as const` arrays below define every event
 * Dash writes hooks for and every loopback endpoint those hooks call. The
 * `DashHookEvent` / `DashHookEndpoint` types derive from them, and ptyManager
 * is constrained to those types when constructing hook URLs — so adding a
 * new endpoint without updating this list fails the TypeScript build, which
 * is the drift-prevention this module is responsible for.
 */

export type HttpHook = { type: 'http'; url: string; async?: boolean };
export type CommandHook = { type: 'command'; command: string };
export type Hook = (HttpHook | CommandHook) & { __dash?: true };
export type HookEntry = { matcher: string; hooks: Hook[] };

/**
 * All hook event names Dash has ever written. Used to decide which existing
 * entries are candidates for replacement vs. preservation.
 *
 * Includes legacy event names (`PostToolUseFailure`, `SubagentStart`,
 * `SubagentStop`) that older Dash versions wrote but the current code does
 * not — kept here so the merge/cleanup paths drop stale entries forward
 * for users updating from those versions.
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
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
] as const;

export type DashHookEvent = (typeof DASH_HOOK_EVENTS)[number];

/**
 * Hook endpoints Dash has ever served on its loopback HookServer. The merge
 * detector matches any URL of the shape `http://127.0.0.1:<port>/hook/<ep>`
 * against this set, regardless of which port the entry was written with.
 *
 * Why port-agnostic: HookServer binds to an ephemeral port at every Dash
 * launch, so prior-session hook URLs always reference a dead port. An
 * earlier version of this module matched URLs against the *current* port
 * prefix only — which made it incapable of recognizing entries from prior
 * sessions, and they accumulated across restarts as ECONNREFUSED-on-every-
 * tool-call landmines. Matching the structural shape (loopback + /hook/ +
 * known endpoint) recognizes them regardless of port.
 *
 * Includes legacy endpoints that older Dash versions wrote so the cleanup
 * migrates them forward.
 */
export const DASH_HOOK_ENDPOINTS = [
  'stop',
  'busy',
  'session-start',
  'notification',
  'context',
  'tool-start',
  'tool-end',
  'stop-failure',
  'compact-start',
  'compact-end',
  'post-tool-use-failure',
  'subagent-start',
  'subagent-stop',
] as const;

export type DashHookEndpoint = (typeof DASH_HOOK_ENDPOINTS)[number];

const DASH_ENDPOINT_SET: ReadonlySet<string> = new Set(DASH_HOOK_ENDPOINTS);

const DASH_URL_RE = /https?:\/\/127\.0\.0\.1:\d+\/hook\/([a-z-]+)/i;

/**
 * Pre-brand Dash versions wrote SessionStart context-injection hooks as a
 * base64-decode command without the `__dash` marker. Recognize the
 * structural shape so users upgrading from those versions don't accumulate
 * duplicate context hooks (the new code tags fresh writes; without this
 * fallback, the old untagged commands would be preserved as "user content"
 * on the first merge and persist alongside the new tagged versions).
 *
 * The patterns are anchored / specific enough to make false-positive
 * collisions with user-authored hooks vanishingly unlikely:
 *  - macOS / Linux: `echo '<base64>' | base64 -D` (or `-d`)
 *  - Windows: `powershell.exe -NoProfile -Command "[Console]::Out.Write...
 *             ::FromBase64String(...`
 */
const DASH_BASE64_DECODE_RE =
  /^echo '[A-Za-z0-9+/=]*' \| base64 -[Dd]$|^powershell\.exe -NoProfile -Command "\[Console\]::Out\.Write/;

function urlMatchesDashEndpoint(s: string): boolean {
  const m = s.match(DASH_URL_RE);
  return m !== null && DASH_ENDPOINT_SET.has(m[1].toLowerCase());
}

function commandLooksLikeDash(s: string): boolean {
  return urlMatchesDashEndpoint(s) || DASH_BASE64_DECODE_RE.test(s);
}

/**
 * Recognise a Dash-authored hook entry. Primary signal is the explicit
 * `__dash: true` brand. URL/command matching is a fallback for the rare
 * case where a round-trip through another tool stripped the unknown field
 * AND for entries written by Dash versions predating the brand.
 *
 * The fallback matches the structural shape `http://127.0.0.1:<port>/hook/<ep>`
 * (any port, any known endpoint) plus the SessionStart base64-decode shape
 * so prior-session URLs and context hooks still get cleaned up.
 */
export function isDashOwnedHook(h: unknown): boolean {
  if (!h || typeof h !== 'object') return false;
  if ((h as { __dash?: unknown }).__dash === true) return true;

  const url = (h as { url?: unknown }).url;
  if (typeof url === 'string' && urlMatchesDashEndpoint(url)) return true;

  const command = (h as { command?: unknown }).command;
  if (typeof command === 'string' && commandLooksLikeDash(command)) return true;

  return false;
}

export function entryIsDashOwned(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const hooks = (entry as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => isDashOwnedHook(h));
}

/**
 * Merge existing hook entries with Dash-owned entries, preserving user-
 * authored content verbatim:
 * - For events Dash manages: drop Dash-owned entries (they get rewritten),
 *   keep user-authored ones.
 * - For events Dash doesn't touch: pass through unchanged.
 * - Then append the fresh Dash entries.
 * - Drop any event whose final value is an empty array, so legacy events
 *   with only Dash-owned entries don't leave behind `"SubagentStart": []`
 *   skeletons in settings.local.json.
 */
export function mergeHookEntries(
  existing: Record<string, HookEntry[] | undefined>,
  dash: Record<string, HookEntry[]>,
): Record<string, HookEntry[]> {
  const merged: Record<string, HookEntry[]> = {};
  const dashEventSet = new Set<string>(DASH_HOOK_EVENTS);
  for (const [event, userEntries] of Object.entries(existing)) {
    if (!Array.isArray(userEntries)) continue;
    merged[event] = dashEventSet.has(event)
      ? userEntries.filter((e) => !entryIsDashOwned(e))
      : userEntries;
  }
  for (const [event, entries] of Object.entries(dash)) {
    const preserved = merged[event] ?? [];
    merged[event] = [...preserved, ...entries];
  }
  for (const event of Object.keys(merged)) {
    if (merged[event].length === 0) delete merged[event];
  }
  return merged;
}
