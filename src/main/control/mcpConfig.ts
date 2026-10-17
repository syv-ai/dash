import * as fs from 'fs';
import * as path from 'path';
import { callerString, type Caller } from './callers';
import { DASH_MCP_SERVER, mcpPermissionName } from './naming';
import type { ControlPaths } from './paths';
import { initializedPaths, tokenFor, writePrivateFile } from './tokens';

/**
 * The per-task `--mcp-config` file: it registers the `dash` MCP server (the
 * launcher) for that task's session, as the task caller with its token. The
 * supervisor freezes the path into the job, so the file must outlive Dash
 * restarts; the token in it stays valid because it is derived, not stored.
 * Env names are the ones `scripts/dash-mcp.ts` reads.
 */

/** Set by control/index.ts once capabilities register (importing the registry here would cycle). */
let readOnlyCapabilities: string[] = [];

/** The capabilities a task's session may call without a permission prompt. */
export function setReadOnlyCapabilities(names: string[]): void {
  readOnlyCapabilities = [...names];
}

function configPath(p: ControlPaths, taskId: string): string {
  return path.join(p.mcpConfigDir, `${taskId}.json`);
}

/** Write `<mcpConfigDir>/<taskId>.json` (0600, atomic) and return its path. Throws before the control API started. */
export function writeTaskMcpConfig(task: { id: string }): string {
  const p = initializedPaths();
  if (!p) throw new Error('control API not running; no mcp-config for tasks');
  const caller: Caller = { kind: 'task', taskId: task.id };
  const config = {
    mcpServers: {
      [DASH_MCP_SERVER]: {
        command: p.launcher,
        args: [],
        env: { DASH_CALLER: callerString(caller), DASH_TOKEN: tokenFor(caller) },
      },
    },
  };
  const file = configPath(p, task.id);
  writePrivateFile(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

/** Remove the task's config file; a no-op when absent or before the control API started. */
export function removeTaskMcpConfig(taskId: string): void {
  const p = initializedPaths();
  if (!p) return;
  fs.rmSync(configPath(p, taskId), { force: true });
}

/**
 * The `--mcp-config` path for a dispatch, or undefined for none: written for
 * a task with Dash access while the control API runs; otherwise any stale
 * file from an earlier dispatch is removed. A write failure dispatches
 * without Dash tools rather than failing the session start.
 */
/**
 * The read-only Dash tools a task may call without a prompt (its settings
 * file's `permissions.allow`); none without access or a running control API.
 */
export function dashAllowTools(dashAccess: boolean): string[] | undefined {
  if (!dashAccess || !initializedPaths()) return undefined;
  return readOnlyCapabilities.map(mcpPermissionName);
}

export function mcpConfigForDispatch(task: {
  id: string;
  dashAccess: boolean;
}): string | undefined {
  if (!initializedPaths()) return undefined;
  try {
    if (task.dashAccess) return writeTaskMcpConfig(task);
    removeTaskMcpConfig(task.id);
  } catch (err) {
    console.error(`[control] mcp-config for task ${task.id} failed; dispatching without it:`, err);
  }
  return undefined;
}
