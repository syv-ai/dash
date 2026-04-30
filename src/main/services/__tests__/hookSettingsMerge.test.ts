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

const dashHttp = (endpoint: string): HookEntry => ({
  matcher: '*',
  hooks: [{ type: 'http', url: `http://127.0.0.1:55123/hook/${endpoint}`, __dash: true }],
});

describe('isDashOwnedHook', () => {
  it('recognises an explicitly tagged hook', () => {
    expect(isDashOwnedHook({ type: 'http', url: 'x', __dash: true })).toBe(true);
  });

  it('recognises an untagged hook by the loopback /hook/<endpoint> shape (brand-loss fallback)', () => {
    // Round-tripping through another tool can strip unknown fields. Without
    // this fallback, every refresh would append a fresh tagged entry while
    // the prior entry stayed unmatched — the file would accumulate duplicates.
    expect(isDashOwnedHook({ type: 'http', url: 'http://127.0.0.1:55123/hook/tool-start' })).toBe(
      true,
    );
  });

  it('recognises a stale-port URL from a prior Dash session', () => {
    // The matcher is port-agnostic — every Dash launch picks a new ephemeral
    // port, so prior-session URLs always have a dead port. They must still
    // be cleaned up or each restart adds another ECONNREFUSED-on-every-tool-
    // call set of hooks.
    expect(
      isDashOwnedHook({ type: 'http', url: 'http://127.0.0.1:53317/hook/tool-start?ptyId=abc' }),
    ).toBe(true);
  });

  it('recognises a curl-command hook targeting a Dash endpoint', () => {
    // Older Dash versions wrote some hooks as `command: curl ...` rather
    // than `type: http`. Those must still be recognized for cleanup.
    const command =
      'curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" ' +
      '-d @- http://127.0.0.1:58903/hook/post-tool-use-failure?ptyId=xyz || exit 0';
    expect(isDashOwnedHook({ type: 'command', command })).toBe(true);
  });

  it('recognises an untagged SessionStart base64-decode context hook (unix)', () => {
    // Dash injects task context via an `echo '<base64>' | base64 -D` hook
    // under SessionStart. Pre-brand versions wrote it without __dash; we
    // need to still recognize the structural shape so an upgrade doesn't
    // duplicate the context hook on every spawn.
    const macOS = "echo 'eyJob29rIjoidGVzdCJ9' | base64 -D";
    const linux = "echo 'eyJob29rIjoidGVzdCJ9' | base64 -d";
    expect(isDashOwnedHook({ type: 'command', command: macOS })).toBe(true);
    expect(isDashOwnedHook({ type: 'command', command: linux })).toBe(true);
  });

  it('recognises an untagged SessionStart base64-decode context hook (windows)', () => {
    const win =
      'powershell.exe -NoProfile -Command "[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(\'eyJ4Ijp0cnVlfQ==\')))"';
    expect(isDashOwnedHook({ type: 'command', command: win })).toBe(true);
  });

  it('does not match a user command that incidentally mentions base64', () => {
    // The regex is anchored to the exact echo|base64 shape Dash writes, so
    // a user command that uses base64 differently is not stolen.
    expect(isDashOwnedHook({ type: 'command', command: 'cat file.txt | base64 -D > out' })).toBe(
      false,
    );
    expect(isDashOwnedHook({ type: 'command', command: 'echo "hello"' })).toBe(false);
  });

  it('does not match a user hook pointing at localhost on a non-/hook path', () => {
    expect(isDashOwnedHook({ type: 'http', url: 'http://127.0.0.1:9999/something' })).toBe(false);
  });

  it('does not match a user hook on /hook/ but with an unknown endpoint', () => {
    // If a user happened to author their own hook at /hook/something-else,
    // we must not steal it. The endpoint list is the discriminator.
    expect(isDashOwnedHook({ type: 'http', url: 'http://127.0.0.1:9999/hook/my-thing' })).toBe(
      false,
    );
  });

  it('does not match when the Dash URL appears as a substring inside a longer url field', () => {
    // The url-field check is anchored to the full string. A user hook
    // whose url field is a sentence that happens to contain a Dash URL
    // must not be classified as Dash-owned (otherwise their hook gets
    // silently deleted on the next merge).
    const url = 'http://other-server.example.com http://127.0.0.1:9999/hook/stop';
    expect(isDashOwnedHook({ type: 'http', url })).toBe(false);
  });

  it('matches a Dash URL with the typical ?ptyId= query string', () => {
    // The URL Dash actually writes — anchor allowing the query suffix.
    const url = 'http://127.0.0.1:55123/hook/tool-start?ptyId=abc-def';
    expect(isDashOwnedHook({ type: 'http', url })).toBe(true);
  });

  it('matches a mixed-case Dash URL (case-insensitive)', () => {
    // Regex carries the /i flag — pin the behavior so a future "tighten
    // the regex" cleanup can't silently change classification.
    const url = 'HTTP://127.0.0.1:55123/Hook/Tool-Start';
    expect(isDashOwnedHook({ type: 'http', url })).toBe(true);
  });

  it('matches a non-curl command that contains a Dash URL substring', () => {
    // Command strings legitimately wrap Dash URLs in larger invocations
    // (curl, but also node -e, wget, etc.) — substring match is required.
    const command = `node -e "fetch('http://127.0.0.1:9/hook/tool-start?ptyId=x')"`;
    expect(isDashOwnedHook({ type: 'command', command })).toBe(true);
  });

  it('treats command hooks without a Dash URL as user-owned', () => {
    expect(isDashOwnedHook({ type: 'command', command: 'echo hi' })).toBe(false);
  });

  it('returns false for null/non-object values', () => {
    expect(isDashOwnedHook(null)).toBe(false);
    expect(isDashOwnedHook(undefined)).toBe(false);
    expect(isDashOwnedHook('string')).toBe(false);
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
    expect(entryIsDashOwned(mixed)).toBe(true);
  });

  it('returns false for an entry containing only user hooks', () => {
    const userOnly: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'command', command: 'echo hi' }],
    };
    expect(entryIsDashOwned(userOnly)).toBe(false);
  });

  it('returns false for malformed entries (no hooks array)', () => {
    expect(entryIsDashOwned({ matcher: '*' })).toBe(false);
    expect(entryIsDashOwned(null)).toBe(false);
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

    const merged = mergeHookEntries(existing, dash);

    expect(merged.PreToolUse).toHaveLength(2);
    // User entry must survive verbatim (deep equality).
    expect(merged.PreToolUse[0]).toEqual(userHook);
    // Dash entry appended after.
    expect(merged.PreToolUse[1].hooks[0]).toMatchObject({ __dash: true });
  });

  it('drops a mixed entry (user hook + Dash hook spliced together) wholesale', () => {
    // entryIsDashOwned is conservative: if any hook in the entry is Dash-
    // owned, the whole entry is dropped. This is the only path where merge
    // legitimately deletes user content; pin the consequence end-to-end so
    // a future "be less aggressive" change doesn't silently change it.
    const mixed: HookEntry = {
      matcher: '*',
      hooks: [
        { type: 'command', command: 'echo my-thing' },
        { type: 'http', url: 'http://127.0.0.1:9/hook/tool-start', __dash: true },
      ],
    };
    const existing = { PreToolUse: [mixed] };
    const dash = { PreToolUse: [dashHttp('tool-start')] };

    const merged = mergeHookEntries(existing, dash);

    // Mixed entry gone; only the fresh Dash entry remains.
    expect(merged.PreToolUse).toHaveLength(1);
    expect(merged.PreToolUse[0].hooks[0]).toMatchObject({ __dash: true });
  });

  it('passes a brand-tagged hook through unchanged on a non-Dash event', () => {
    // Dash only filters events listed in DASH_HOOK_EVENTS. A __dash-tagged
    // hook accidentally landing on a non-managed event (e.g. CustomEvent)
    // must not be filtered — we don't claim ownership of unrelated events.
    const tagged: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'http', url: 'http://127.0.0.1:9/hook/tool-start', __dash: true }],
    };
    const existing = { CustomEvent: [tagged] };

    const merged = mergeHookEntries(existing, {});

    expect(merged.CustomEvent).toEqual([tagged]);
  });

  it('drops Dash-owned entries from existing so refreshes don’t accumulate duplicates', () => {
    // Simulate a refresh: prior write left a tagged Dash entry; the next
    // write must replace it, not add a sibling.
    const stale: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'http', url: 'http://127.0.0.1:55123/hook/tool-start', __dash: true }],
    };
    const existing = { PreToolUse: [stale] };
    const dash = { PreToolUse: [dashHttp('tool-start')] };

    const merged = mergeHookEntries(existing, dash);

    expect(merged.PreToolUse).toHaveLength(1);
  });

  it('drops Dash-owned entries even when the brand was lost in round-trip (URL fallback)', () => {
    // Same as above but `__dash` was stripped — the URL fallback in
    // isDashOwnedHook is what stops duplicate accumulation here.
    const orphan: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'http', url: 'http://127.0.0.1:55123/hook/tool-start' }],
    };
    const existing = { PreToolUse: [orphan] };
    const dash = { PreToolUse: [dashHttp('tool-start')] };

    const merged = mergeHookEntries(existing, dash);

    expect(merged.PreToolUse).toHaveLength(1);
  });

  it('drops stale-port Dash entries from prior sessions (ECONNREFUSED migration)', () => {
    // The bug this guards against: pre-`__dash`-brand Dash versions wrote
    // hooks without the brand. After upgrading, every new Dash session got
    // a different ephemeral port, but the merge couldn't recognize the old
    // ones because URL matching was tied to the *current* port. The file
    // accumulated ~one set per launch; tools fired hooks against dead ports
    // and emitted ECONNREFUSED on every Bash call.
    const stalePort1: HookEntry = {
      hooks: [{ type: 'http', url: 'http://127.0.0.1:53317/hook/tool-start?ptyId=old-1' }],
    } as HookEntry;
    const stalePort2: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'http', url: 'http://127.0.0.1:64617/hook/tool-start?ptyId=old-2' }],
    };
    const existing = { PreToolUse: [stalePort1, stalePort2] };
    const dash = { PreToolUse: [dashHttp('tool-start')] };

    const merged = mergeHookEntries(existing, dash);

    expect(merged.PreToolUse).toHaveLength(1);
    expect(merged.PreToolUse[0].hooks[0]).toMatchObject({ __dash: true });
  });

  it('drops stale curl-command Dash entries on legacy event names and removes the empty key', () => {
    // Older Dash versions wrote `command: curl ...` hooks under
    // PostToolUseFailure / SubagentStart / SubagentStop. The current code
    // doesn't write those events, but DASH_HOOK_EVENTS still lists them so
    // the merge cleans them out — and drops the key entirely so we don't
    // leave `"SubagentStart": []` skeletons in settings.local.json.
    const legacy: HookEntry = {
      hooks: [
        {
          type: 'command',
          command:
            'curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" ' +
            '-d @- http://127.0.0.1:58903/hook/subagent-start?ptyId=zzz || exit 0',
        },
      ],
    } as HookEntry;
    const existing = { SubagentStart: [legacy] };

    const merged = mergeHookEntries(existing, {});

    expect(merged.SubagentStart).toBeUndefined();
    expect(Object.keys(merged)).not.toContain('SubagentStart');
  });

  it('drops the key when an active managed event ends up with no entries', () => {
    // If the only thing in the existing file for a Dash-managed event is a
    // stale Dash entry and we don't write a fresh one this round (e.g. the
    // event was disabled), the merged file should not retain an empty
    // array under that key.
    const stale: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'http', url: 'http://127.0.0.1:55123/hook/tool-start', __dash: true }],
    };
    const merged = mergeHookEntries({ PreToolUse: [stale] }, {});
    expect(merged.PreToolUse).toBeUndefined();
  });

  it('preserves a user-authored hook even on a legacy Dash-managed event', () => {
    // If a user happens to have written their own SubagentStart hook, we
    // must keep it across the cleanup. Only Dash-owned entries get dropped.
    const userHook: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'command', command: 'echo my-subagent-hook' }],
    };
    const existing = { SubagentStart: [userHook] };

    const merged = mergeHookEntries(existing, {});

    expect(merged.SubagentStart).toEqual([userHook]);
  });

  it('passes user hooks on non-Dash events through unchanged', () => {
    // PreCompact is a Dash-managed event; CustomEvent is not.
    const customEvent: HookEntry = {
      matcher: '*',
      hooks: [{ type: 'command', command: 'user-script' }],
    };
    const existing = { CustomEvent: [customEvent] };
    const dash = { PreCompact: [dashHttp('compact-start')] };

    const merged = mergeHookEntries(existing, dash);

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

    const merged = mergeHookEntries(existing, dash);

    expect(merged.Notification).toEqual([userHook]);
  });

  it('skips entries whose value is not an array (defensive against hand-edited json)', () => {
    // The raw json read can be `"hooks": { "PreToolUse": "garbage" }`. The
    // merge must not throw or coerce — it should just skip and continue.
    const existing = { PreToolUse: 'not-an-array' as unknown as HookEntry[] };
    const dash = { PreToolUse: [dashHttp('tool-start')] };

    const merged = mergeHookEntries(existing, dash);

    expect(merged.PreToolUse).toHaveLength(1);
    expect(merged.PreToolUse[0].hooks[0]).toMatchObject({ __dash: true });
  });

  it('handles a fully empty existing object', () => {
    const merged = mergeHookEntries({}, { PreToolUse: [dashHttp('tool-start')] });
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

    const merged = mergeHookEntries(existing, dash);

    expect(merged.PreToolUse).toContainEqual(userBash);
    expect(merged.PostToolUse).toContainEqual(userPost);
    expect(merged.PreToolUse).toHaveLength(2);
    expect(merged.PostToolUse).toHaveLength(2);
  });
});
