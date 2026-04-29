import { describe, it, expect } from 'vitest';
import {
  type HookEntry,
  entryIsDashOwned,
  isDashOwnedHook,
  mergeHookEntries,
} from '../hookSettingsMerge';

// ---------------------------------------------------------------------------
// Settings-merge safety. The load-bearing promise of writeHookSettings is
// "merge with existing settings to preserve user content" — these tests
// guard the user-authored-hook-survival invariant. A regression here is a
// silent data-loss bug (user's own hooks vanish without warning), so this
// is one of the highest-value test surfaces in the project.
//
// The merge module is pure (no DB, no electron, no native deps), so we can
// exercise it directly against the real exported function — no mocking, no
// re-implementation drift.
// ---------------------------------------------------------------------------

const DASH_PORT_PREFIX = 'http://127.0.0.1:55123/hook/';

const dashHttp = (endpoint: string): HookEntry => ({
  matcher: '*',
  hooks: [{ type: 'http', url: `${DASH_PORT_PREFIX}${endpoint}`, __dash: true }],
});

describe('isDashOwnedHook', () => {
  it('recognises an explicitly tagged hook', () => {
    expect(isDashOwnedHook({ type: 'http', url: 'x', __dash: true }, DASH_PORT_PREFIX)).toBe(true);
  });

  it('recognises an untagged hook by the Dash hookServer URL prefix (brand-loss fallback)', () => {
    // Round-tripping through another tool can strip unknown fields. Without
    // this fallback, every refresh would append a fresh tagged entry while
    // the prior entry stayed unmatched — the file would accumulate duplicates.
    expect(
      isDashOwnedHook({ type: 'http', url: `${DASH_PORT_PREFIX}tool-start` }, DASH_PORT_PREFIX),
    ).toBe(true);
  });

  it('does not match a user hook even if it points at localhost (different port)', () => {
    expect(
      isDashOwnedHook({ type: 'http', url: 'http://127.0.0.1:9999/something' }, DASH_PORT_PREFIX),
    ).toBe(false);
  });

  it('treats command hooks without the tag as user-owned', () => {
    expect(isDashOwnedHook({ type: 'command', command: 'echo hi' }, DASH_PORT_PREFIX)).toBe(false);
  });

  it('returns false for null/non-object values', () => {
    expect(isDashOwnedHook(null, DASH_PORT_PREFIX)).toBe(false);
    expect(isDashOwnedHook(undefined, DASH_PORT_PREFIX)).toBe(false);
    expect(isDashOwnedHook('string', DASH_PORT_PREFIX)).toBe(false);
  });

  it('falls back to brand-only matching when the hookServer port is unbound (null prefix)', () => {
    // At startup the hookServer hasn't bound yet, so the prefix is null.
    // Brand match must still work; URL-fallback is silently disabled.
    expect(isDashOwnedHook({ type: 'http', url: 'x', __dash: true }, null)).toBe(true);
    expect(isDashOwnedHook({ type: 'http', url: `${DASH_PORT_PREFIX}foo` }, null)).toBe(false);
  });
});

describe('entryIsDashOwned', () => {
  it('returns true if any hook in the entry is Dash-owned', () => {
    const mixed: HookEntry = {
      matcher: '*',
      hooks: [
        { type: 'command', command: 'user-thing' },
        { type: 'http', url: 'x', __dash: true },
      ],
    };
    // Conservative: entries with a mix get treated as ours. Users shouldn't
    // splice their hooks into a Dash-owned entry; if they do, we'd rather
    // remove the whole entry on cleanup than leave a mystery tagged hook.
    expect(entryIsDashOwned(mixed, DASH_PORT_PREFIX)).toBe(true);
  });

  it('returns false for an entry containing only user hooks', () => {
    const userOnly: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'command', command: 'echo hi' }],
    };
    expect(entryIsDashOwned(userOnly, DASH_PORT_PREFIX)).toBe(false);
  });

  it('returns false for malformed entries (no hooks array)', () => {
    expect(entryIsDashOwned({ matcher: '*' }, DASH_PORT_PREFIX)).toBe(false);
    expect(entryIsDashOwned(null, DASH_PORT_PREFIX)).toBe(false);
  });
});

describe('mergeHookEntries — user content preservation', () => {
  it('preserves a user-authored hook on a Dash-managed event (PreToolUse)', () => {
    const userHook: HookEntry = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo from-user' }],
    };
    const existing = { PreToolUse: [userHook] };
    const dash = { PreToolUse: [dashHttp('tool-start')] };

    const merged = mergeHookEntries(existing, dash, DASH_PORT_PREFIX);

    expect(merged.PreToolUse).toHaveLength(2);
    // User entry must survive verbatim (deep equality).
    expect(merged.PreToolUse[0]).toEqual(userHook);
    // Dash entry appended after.
    expect(merged.PreToolUse[1].hooks[0]).toMatchObject({ __dash: true });
  });

  it('drops Dash-owned entries from existing so refreshes don’t accumulate duplicates', () => {
    // Simulate a refresh: prior write left a tagged Dash entry; the next
    // write must replace it, not add a sibling.
    const stale: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'http', url: `${DASH_PORT_PREFIX}tool-start`, __dash: true }],
    };
    const existing = { PreToolUse: [stale] };
    const dash = { PreToolUse: [dashHttp('tool-start')] };

    const merged = mergeHookEntries(existing, dash, DASH_PORT_PREFIX);

    expect(merged.PreToolUse).toHaveLength(1);
  });

  it('drops Dash-owned entries even when the brand was lost in round-trip (URL fallback)', () => {
    // Same as above but `__dash` was stripped — the URL fallback in
    // isDashOwnedHook is what stops duplicate accumulation here.
    const orphan: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'http', url: `${DASH_PORT_PREFIX}tool-start` }],
    };
    const existing = { PreToolUse: [orphan] };
    const dash = { PreToolUse: [dashHttp('tool-start')] };

    const merged = mergeHookEntries(existing, dash, DASH_PORT_PREFIX);

    expect(merged.PreToolUse).toHaveLength(1);
  });

  it('passes user hooks on non-Dash events through unchanged', () => {
    // PreCompact is a Dash-managed event; CustomEvent is not.
    const customEvent: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'command', command: 'user-script' }],
    };
    const existing = { CustomEvent: [customEvent] };
    const dash = { PreCompact: [dashHttp('compact-start')] };

    const merged = mergeHookEntries(existing, dash, DASH_PORT_PREFIX);

    // Non-Dash event must NOT be filtered (Dash doesn't claim ownership of
    // events it doesn't write to).
    expect(merged.CustomEvent).toEqual([customEvent]);
    expect(merged.PreCompact).toHaveLength(1);
  });

  it('preserves a user hook on a Dash-managed event when no Dash entry replaces it', () => {
    // A user might author a Notification hook even though Dash also manages
    // Notification. The merge produces the user's entry kept, plus whatever
    // Dash adds — never an empty array that loses the user's hook.
    const userHook: HookEntry = {
      matcher: 'idle_prompt',
      hooks: [{ type: 'command', command: 'osascript -e display dialog "hi"' }],
    };
    const existing = { Notification: [userHook] };
    const dash = {}; // pretend we didn't write Notification this round

    const merged = mergeHookEntries(existing, dash, DASH_PORT_PREFIX);

    expect(merged.Notification).toEqual([userHook]);
  });

  it('skips entries whose value is not an array (defensive against hand-edited json)', () => {
    // The raw json read can be `"hooks": { "PreToolUse": "garbage" }`. The
    // merge must not throw or coerce — it should just skip and continue.
    const existing = { PreToolUse: 'not-an-array' as unknown as HookEntry[] };
    const dash = { PreToolUse: [dashHttp('tool-start')] };

    const merged = mergeHookEntries(existing, dash, DASH_PORT_PREFIX);

    expect(merged.PreToolUse).toHaveLength(1);
    expect(merged.PreToolUse[0].hooks[0]).toMatchObject({ __dash: true });
  });

  it('handles a fully empty existing object', () => {
    const merged = mergeHookEntries({}, { PreToolUse: [dashHttp('tool-start')] }, DASH_PORT_PREFIX);
    expect(Object.keys(merged)).toEqual(['PreToolUse']);
  });

  it('preserves multiple sibling user hooks across managed events', () => {
    const userBash: HookEntry = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'log-bash' }],
    };
    const userPost: HookEntry = {
      matcher: 'Read',
      hooks: [{ type: 'command', command: 'log-read' }],
    };
    const existing = {
      PreToolUse: [userBash],
      PostToolUse: [userPost],
    };
    const dash = {
      PreToolUse: [dashHttp('tool-start')],
      PostToolUse: [dashHttp('tool-end')],
    };

    const merged = mergeHookEntries(existing, dash, DASH_PORT_PREFIX);

    expect(merged.PreToolUse).toContainEqual(userBash);
    expect(merged.PostToolUse).toContainEqual(userPost);
    expect(merged.PreToolUse).toHaveLength(2);
    expect(merged.PostToolUse).toHaveLength(2);
  });
});
