import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { controlPaths } from '../paths';

const TASK_ID = '11111111-2222-3333-4444-555555555555';

let userData: string;

// A fresh module graph per test: tokens.ts keeps the initialised dir in module state.
async function load() {
  vi.resetModules();
  const tokens = await import('../tokens');
  const mcpConfig = await import('../mcpConfig');
  return { tokens, mcpConfig };
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-mcpconfig-'));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('writeTaskMcpConfig', () => {
  it('writes a 0600 config that runs the launcher as the task, with its token', async () => {
    const { tokens, mcpConfig } = await load();
    tokens.initTokens(userData);
    const file = mcpConfig.writeTaskMcpConfig({ id: TASK_ID });

    const paths = controlPaths(userData);
    expect(file).toBe(path.join(paths.mcpConfigDir, `${TASK_ID}.json`));
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      mcpServers: {
        dash: {
          command: paths.launcher,
          args: [],
          env: {
            DASH_CALLER: `task:${TASK_ID}`,
            DASH_TOKEN: tokens.tokenFor({ kind: 'task', taskId: TASK_ID }),
          },
        },
      },
    });
    // Atomic write: no temp files left beside it.
    expect(fs.readdirSync(paths.mcpConfigDir)).toEqual([`${TASK_ID}.json`]);
  });

  it('throws before the control API initialised its tokens', async () => {
    const { mcpConfig } = await load();
    expect(() => mcpConfig.writeTaskMcpConfig({ id: TASK_ID })).toThrow();
  });
});

describe('removeTaskMcpConfig', () => {
  it('removes the file, and is a no-op when absent or uninitialised', async () => {
    const { tokens, mcpConfig } = await load();
    expect(() => mcpConfig.removeTaskMcpConfig(TASK_ID)).not.toThrow();
    tokens.initTokens(userData);
    const file = mcpConfig.writeTaskMcpConfig({ id: TASK_ID });
    mcpConfig.removeTaskMcpConfig(TASK_ID);
    expect(fs.existsSync(file)).toBe(false);
    expect(() => mcpConfig.removeTaskMcpConfig(TASK_ID)).not.toThrow();
  });
});

describe('mcpConfigForDispatch', () => {
  it('writes and returns the path for a task with Dash access', async () => {
    const { tokens, mcpConfig } = await load();
    tokens.initTokens(userData);
    const dispatch = mcpConfig.mcpConfigForDispatch({ id: TASK_ID, dashAccess: true });
    expect(dispatch?.path).toBe(path.join(controlPaths(userData).mcpConfigDir, `${TASK_ID}.json`));
    expect(fs.existsSync(dispatch!.path)).toBe(true);
  });

  it('allows the read-only tools by their MCP permission names', async () => {
    const { tokens, mcpConfig } = await load();
    tokens.initTokens(userData);
    mcpConfig.setReadOnlyCapabilities(['tasks.list', 'services.output']);
    expect(mcpConfig.mcpConfigForDispatch({ id: TASK_ID, dashAccess: true })?.allowTools).toEqual([
      'mcp__dash__tasks_list',
      'mcp__dash__services_output',
    ]);
  });

  it('returns nothing and removes a stale file for a task without access', async () => {
    const { tokens, mcpConfig } = await load();
    tokens.initTokens(userData);
    const stale = mcpConfig.writeTaskMcpConfig({ id: TASK_ID });
    expect(mcpConfig.mcpConfigForDispatch({ id: TASK_ID, dashAccess: false })).toBeUndefined();
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('returns nothing while the control API is not running', async () => {
    const { mcpConfig } = await load();
    expect(mcpConfig.mcpConfigForDispatch({ id: TASK_ID, dashAccess: true })).toBeUndefined();
  });
});
