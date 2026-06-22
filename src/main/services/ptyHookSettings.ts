import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { hookServer } from './HookServer';
import { RtkService } from './RtkService';
import { DatabaseService } from './DatabaseService';
import { isClaudeVersionAtLeast } from './claudeCli';
import {
  type Hook,
  type HookEntry,
  type CommandHook,
  type DashHookEndpoint,
  type DashHookEvent,
  DASH_HOOK_EVENTS,
  entryIsDashOwned,
  mergeHookEntries,
} from './hookSettingsMerge';

/**
 * Generation of `.claude/settings.local.json` — the hooks, statusLine, commit
 * attribution, and MCP pre-grant that wire a spawned Claude Code process to
 * Dash's local HookServer. Split out of ptyManager: this is the file-writing
 * machinery; ptyManager owns the PTY lifecycle and drives the live refresh
 * (refreshActivePtyHooks) over its `ptys` Map.
 */

/** Tracks all settings.local.json paths Dash has written hooks to, for cleanup on exit. */
const writtenSettingsPaths = new Set<string>();

const DASH_DEFAULT_ATTRIBUTION =
  '\n\nCo-Authored-By: Claude <noreply@anthropic.com> via Dash <dash@syv.ai>';

// Commit attribution setting: undefined = "default" (use Dash attribution),
// '' = "none" (suppress attribution), any other string = custom text.
let commitAttributionSetting: string | undefined = undefined;

/**
 * Set the commit-attribution value used by the next settings write. Does NOT
 * rewrite active PTYs — ptyManager.setCommitAttribution pairs this with
 * refreshActivePtyHooks so the live-rewrite stays where the `ptys` Map lives.
 */
export function setCommitAttributionValue(value: string | undefined): void {
  commitAttributionSetting = value;
}

/** Retrieve stored task context prompt from the database. */
function getTaskContextPrompt(taskId: string): string | null {
  try {
    const task = DatabaseService.getTask(taskId);
    return task?.contextPrompt ?? null;
  } catch (err) {
    console.error('[getTaskContextPrompt] Failed to read context for task', taskId, err);
    return null;
  }
}

/**
 * Mark a hook as Dash-authored. The brand lets the merge module recognize
 * it on the next rewrite without falling back to URL/command-shape pattern
 * matching.
 */
function tagDash<T extends CommandHook>(hook: T): T & { __dash: true } {
  return { ...hook, __dash: true };
}

/**
 * Build the PreToolUse hook entries. `*` matcher always points at our
 * tool-start endpoint; when RTK is enabled, also add a `Bash`-matcher
 * entry that runs RTK's hook command to rewrite verbose Bash output
 * before Claude consumes it.
 */
function buildPreToolUseHooks(
  dashCmd: (endpoint: DashHookEndpoint, async?: boolean) => Hook,
): HookEntry[] {
  const entries: HookEntry[] = [{ matcher: '*', hooks: [dashCmd('tool-start', true)] }];
  const rtkCmd = RtkService.isEnabled() ? RtkService.getHookCommand() : null;
  if (rtkCmd) {
    entries.push({ matcher: 'Bash', hooks: [tagDash({ type: 'command', command: rtkCmd })] });
  }
  return entries;
}

/**
 * Atomic write: stage to a sibling tmp file then rename over the target.
 * POSIX rename is atomic, so a crash mid-write can never leave a half-
 * written file at `target`. Important here because settings.local.json is
 * rewritten frequently (every PTY spawn, every commit-attribution change)
 * and the corrupt-recovery path on the read side would otherwise have to
 * handle a wider class of partial-write failures than just user edits.
 *
 * On failure (write error mid-data, or rename error after a successful
 * write), unlink the tmp file best-effort before rethrowing so failed
 * writes don't accumulate orphan `*.tmp-<pid>-<ts>` files alongside the
 * user's settings.
 */
function atomicWriteFileSync(target: string, data: string): void {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best-effort: tmp may not exist if writeFileSync failed before
      // creating the file, or unlink may race with another process.
    }
    throw err;
  }
}

function broadcastToast(message: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('app:toast', { message });
    }
  }
}

export type HookWriteResult = { ok: true } | { ok: false; settingsPath: string; error: string };

/**
 * Write .claude/settings.local.json with hooks for activity monitoring,
 * tool tracking, error detection, and context usage.
 *
 * Hooks use type: "http" — Claude Code POSTs the hook JSON body directly
 * to our local HookServer. The statusLine uses type: "command" with curl
 * (http type is not supported for statusLine).
 *
 * Merging preserves user-authored entries via the merge module's brand-or-
 * URL-shape detector, so users can have their own hooks under managed
 * events without losing them on every rewrite.
 *
 * Returns a result so refreshActivePtyHooks can aggregate failures across
 * tasks; toasts and console.error are still emitted inline regardless.
 */
export function writeHookSettings(cwd: string, ptyId: string): HookWriteResult {
  const port = hookServer.port;
  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');

  // The await order in main.ts (`await hookServer.start()` before IPC
  // registration) makes this branch unreachable in normal startup; if we hit
  // it, something has invoked writeHookSettings outside the IPC entry path.
  // Surface it loudly rather than leaving stale on-disk hooks unchanged.
  if (port === 0) {
    console.error(
      '[writeHookSettings] HookServer port not bound — settings.local.json not updated. ' +
        `Likely a startup-ordering bug (caller invoked before hookServer.start() resolved). cwd=${cwd}`,
    );
    broadcastToast(
      `Hook server not ready — task hooks couldn't be written for ${path.basename(cwd)}. Restart Dash to recover.`,
    );
    return { ok: false, settingsPath, error: 'HookServer port not bound' };
  }

  // Hooks post to the HookServer via a guarded curl command, NOT a baked
  // `type: "http"` URL. Two reasons, both about the URL no longer hard-coding
  // the port:
  //   1. The port is read at runtime from $DASH_HOOK_PORT, which ptyManager
  //      injects into the env of the Claude process Dash spawns. A session NOT
  //      launched by Dash (the user opening the same worktree in a plain
  //      `claude`) has no such var, so the `[ -n … ] || exit 0` guard makes
  //      every hook a silent no-op instead of an ECONNREFUSED error.
  //   2. Even inside Dash, the HookServer binds a fresh ephemeral port each
  //      launch — reading it live means a stale settings.local.json from a
  //      prior session self-heals instead of firing at a dead port.
  // The hook payload arrives on the command's stdin; `-d @-` forwards it as the
  // POST body, matching what the old http hook sent.
  //
  // POSIX-sh only, by design. Claude Code runs command hooks via `sh -c` on
  // macOS/Linux (so this is safe even for fish/zsh users) and via Git Bash or
  // PowerShell on Windows. Dash ships macOS arm64 + Linux x64 only, so this
  // syntax targets `sh` and is NOT given a win32 branch — unlike the
  // context-injection hook below, whose base64 decode genuinely differs by OS.
  // The `$DASH_HOOK_PORT` guard, not Windows support, is the reason it's a
  // command rather than the old `type:"http"` hook.
  const hookCommand = (endpoint: DashHookEndpoint): string => {
    const url = `http://127.0.0.1:$DASH_HOOK_PORT/hook/${endpoint}?ptyId=${ptyId}`;
    return (
      `[ -n "$DASH_HOOK_PORT" ] || exit 0; ` +
      `curl -s --max-time 2 -X POST -H 'Content-Type: application/json' -d @- "${url}" >/dev/null 2>&1`
    );
  };

  const commandHook = (endpoint: DashHookEndpoint, async?: boolean): CommandHook => ({
    type: 'command' as const,
    command: hookCommand(endpoint),
    ...(async ? { async: true } : {}),
  });

  const dashCmd = (endpoint: DashHookEndpoint, async?: boolean) =>
    tagDash(commandHook(endpoint, async));

  // Typed against DashHookEvent so a typo'd event key (e.g. 'PreToolUze')
  // fails the build, matching the drift-prevention DashHookEndpoint gives
  // us for endpoints.
  const dashEntries: Partial<Record<DashHookEvent, HookEntry[]>> = {
    Stop: [{ matcher: '', hooks: [dashCmd('stop')] }],
    UserPromptSubmit: [{ matcher: '', hooks: [dashCmd('busy')] }],
    Notification: [
      { matcher: 'permission_prompt', hooks: [dashCmd('notification')] },
      { matcher: 'idle_prompt', hooks: [dashCmd('notification')] },
    ],
    PreToolUse: buildPreToolUseHooks(dashCmd),
    PostToolUse: [{ matcher: '*', hooks: [dashCmd('tool-end', true)] }],
    PreCompact: [{ matcher: '*', hooks: [dashCmd('compact-start', true)] }],
    SessionEnd: [{ matcher: '*', hooks: [dashCmd('session-end', true)] }],
  };

  // PostCompact added in Claude Code 2.1.76; older CLIs reject the key and
  // skip the entire settings file (GH #127), losing all Dash hooks.
  if (isClaudeVersionAtLeast(2, 1, 76)) {
    dashEntries.PostCompact = [{ matcher: '*', hooks: [dashCmd('compact-end', true)] }];
  }

  // StopFailure added in Claude Code 2.1.78.
  if (isClaudeVersionAtLeast(2, 1, 78)) {
    dashEntries.StopFailure = [{ matcher: '*', hooks: [dashCmd('stop-failure')] }];
  }

  // SessionStart(clear|compact) → defensive idle. /clear and auto-compact
  // reset the session, so any prior busy state on the activity dot is stale.
  // SessionStart(resume) is NOT wired — register() already initialises and a
  // resumed session's busy state will be re-established by the next
  // UserPromptSubmit / PreToolUse hook. SessionStart(startup) was previously
  // wired to /hook/agent-startup for the ports onboarding TUI's auto-detect
  // path; we dropped that — see PortsSetupWizard (the agent self-starts via the
  // inlined initial prompt instead).
  const sessionStartEntries: HookEntry[] = [
    { matcher: 'clear', hooks: [dashCmd('session-start', true)] },
    { matcher: 'compact', hooks: [dashCmd('session-start', true)] },
  ];

  // SessionStart context-injection: re-inject the task context (linked
  // issue/work-item prompt) on startup, compact, and clear — NOT resume,
  // since resumed sessions already have context in history. Coexists with
  // the defensive-idle HTTP hooks on the same clear/compact matchers.
  const contextPrompt = getTaskContextPrompt(ptyId);
  if (contextPrompt) {
    const hookPayload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: contextPrompt,
      },
    });
    // Use base64 encoding to safely embed user-controlled content in a shell command.
    // Single-quote escaping is fragile with content from GitHub issues / ADO work items.
    const b64 = Buffer.from(hookPayload).toString('base64');
    // Cross-platform decode: macOS uses `base64 -D`, Linux uses `base64 -d`,
    // Windows cmd.exe doesn't have base64 so we use PowerShell instead.
    const decodeCmd =
      process.platform === 'win32'
        ? `powershell.exe -NoProfile -Command "[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))"`
        : `echo '${b64}' | base64 ${process.platform === 'darwin' ? '-D' : '-d'}`;
    const contextHook: CommandHook = { type: 'command', command: decodeCmd };
    for (const entry of sessionStartEntries) {
      // clear and compact already exist — append the context hook alongside
      // the idle hook so both fire from the same matcher.
      entry.hooks.push(tagDash(contextHook));
    }
    sessionStartEntries.push({ matcher: 'startup', hooks: [tagDash(contextHook)] });
  }

  dashEntries.SessionStart = sessionStartEntries;

  try {
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    let existing: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as unknown;
        // JSON.parse succeeds on "null", "42", "[]", etc. Only plain objects
        // can be spread and merged safely; anything else is treated as corrupt.
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        } else {
          throw new Error(`settings.local.json is not a JSON object (got ${typeof parsed})`);
        }
      } catch (err) {
        // Back up the corrupt file before overwriting so the user can recover.
        // If the backup rename fails, we MUST NOT proceed to overwrite — that
        // would destroy the user's on-disk file with no copy left.
        const backupPath = `${settingsPath}.corrupt-${Date.now()}.bak`;
        try {
          fs.renameSync(settingsPath, backupPath);
          console.error(
            `[writeHookSettings] settings.local.json corrupt at ${settingsPath}; backed up to ${backupPath}`,
            err,
          );
          broadcastToast(
            `settings.local.json was unreadable — backed up to ${path.basename(backupPath)} and rewritten.`,
          );
        } catch (renameErr) {
          console.error(
            '[writeHookSettings] Failed to back up corrupt file; leaving on-disk file intact:',
            renameErr,
          );
          broadcastToast(
            `settings.local.json is corrupt and could not be backed up — hooks are off for this task. Fix or remove ${path.basename(settingsPath)} manually.`,
          );
          return {
            ok: false,
            settingsPath,
            error: `corrupt settings.local.json; backup rename failed: ${renameErr instanceof Error ? renameErr.message : String(renameErr)}`,
          };
        }
      }
    }

    const existingHooks =
      existing.hooks && typeof existing.hooks === 'object'
        ? (existing.hooks as Record<string, HookEntry[] | undefined>)
        : {};

    const mergedHooks = mergeHookEntries(existingHooks, dashEntries);

    const merged: Record<string, unknown> = {
      ...existing,
      hooks: mergedHooks,
    };

    // The statusLine doubles as the context-usage reporter: it POSTs to the
    // context endpoint and discards output (so the bar stays blank). Same guarded
    // command shape as the hooks, so it too no-ops outside Dash.
    merged.statusLine = {
      type: 'command',
      command: hookCommand('context'),
    };

    const effectiveAttribution =
      commitAttributionSetting === undefined ? DASH_DEFAULT_ATTRIBUTION : commitAttributionSetting;
    merged.attribution = { commit: effectiveAttribution };

    // Pre-grant every project-level MCP server (.mcp.json) so Dash's first
    // spawn into a worktree doesn't trip "Allow this MCP server?" modals for
    // each one. The user already opted in by checking .mcp.json into the
    // project; making them re-approve per worktree is just friction. NOTE: a
    // narrower `enabledMcpjsonServers: [...]` allowlist is safer per Anthropic's
    // docs, but Dash can't know the server names without reading .mcp.json on
    // every settings write. Don't overwrite if user/team explicitly set either
    // key — let their decision win.
    if (
      typeof merged.enableAllProjectMcpServers !== 'boolean' &&
      !Array.isArray(merged.enabledMcpjsonServers)
    ) {
      merged.enableAllProjectMcpServers = true;
    }

    atomicWriteFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    writtenSettingsPaths.add(settingsPath);
    return { ok: true };
  } catch (err) {
    console.error('[writeHookSettings] Failed:', err);
    broadcastToast(`Could not write ${path.basename(settingsPath)} — hooks are off for this task.`);
    return {
      ok: false,
      settingsPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Remove Dash-written hooks and attribution from all settings.local.json files
 * that were written during this session. Preserves user-authored entries
 * by filtering against the merge module's Dash-owned detector instead of
 * deleting the entire managed-event keys.
 */
export function cleanupHookSettings(): void {
  for (const settingsPath of writtenSettingsPaths) {
    try {
      if (!fs.existsSync(settingsPath)) continue;

      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hooks = raw.hooks;

      if (hooks && typeof hooks === 'object') {
        for (const key of DASH_HOOK_EVENTS) {
          const entries = hooks[key];
          if (!Array.isArray(entries)) continue;
          const userOnly = entries.filter((e) => !entryIsDashOwned(e));
          if (userOnly.length === 0) delete hooks[key];
          else hooks[key] = userOnly;
        }
        if (Object.keys(hooks).length === 0) {
          delete raw.hooks;
        }
      }

      delete raw.statusLine;
      delete raw.attribution;

      if (Object.keys(raw).length === 0) {
        fs.unlinkSync(settingsPath);
      } else {
        atomicWriteFileSync(settingsPath, JSON.stringify(raw, null, 2) + '\n');
      }
    } catch (err) {
      console.error(`[cleanupHookSettings] Failed for ${settingsPath}:`, err);
    }
  }

  writtenSettingsPaths.clear();
}
