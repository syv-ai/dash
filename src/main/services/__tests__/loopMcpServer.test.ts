import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoopLevel } from '@shared/types';

vi.mock('electron', () => ({ default: {} }));

// The MCP tools drive these singletons; mock them so the test exercises the tool
// dispatch + level-gating, not the real scheduler/fs.
vi.mock('../LoopController', () => ({
  loopController: {
    getContext: vi.fn(),
    getStatus: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  },
}));

vi.mock('../LoopService', () => ({
  LoopService: {
    readState: vi.fn(async () => '# STATE'),
    writeState: vi.fn(async () => {}),
    appendManagerNotes: vi.fn(async () => {}),
    appendRunLog: vi.fn(async () => {}),
  },
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildLoopMcpServer } from '../loopMcpServer';
import { loopController } from '../LoopController';
import { LoopService } from '../LoopService';

/** Connect a client to a fresh server bound to `taskId` over an in-memory pair. */
async function connectClient(taskId: string): Promise<Client> {
  const server = buildLoopMcpServer(taskId);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientT);
  return client;
}

function textOf(res: { content?: Array<{ type: string; text?: string }>; isError?: boolean }) {
  return res.content?.map((c) => c.text ?? '').join('') ?? '';
}

function runningLoop(level: LoopLevel) {
  vi.mocked(loopController.getContext).mockReturnValue({ cwd: '/wt/t1', level });
}

describe('loopMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runningLoop('L2');
  });

  it('exposes the full loop tool surface', async () => {
    const client = await connectClient('t1');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'loop_append_run_log',
        'loop_escalate',
        'loop_get_state',
        'loop_kill',
        'loop_pause',
        'loop_resume',
        'loop_status',
        'loop_steer',
        'loop_update_state',
      ].sort(),
    );
  });

  it('loop_status returns the scheduler status', async () => {
    vi.mocked(loopController.getStatus).mockReturnValue({
      taskId: 't1',
      state: 'running',
      iteration: 3,
      maxIterations: 10,
      tokensSpent: 100,
      tokenBudget: null,
      updatedAt: 0,
    });
    const client = await connectClient('t1');
    const res = await client.callTool({ name: 'loop_status', arguments: {} });
    expect(textOf(res as never)).toContain('"iteration": 3');
  });

  it('loop_steer appends to manager-notes for the next iteration', async () => {
    const client = await connectClient('t1');
    const res = await client.callTool({
      name: 'loop_steer',
      arguments: { message: 'prioritize the failing auth test' },
    });
    expect(LoopService.appendManagerNotes).toHaveBeenCalledWith(
      '/wt/t1',
      '- prioritize the failing auth test',
    );
    expect((res as { isError?: boolean }).isError).toBeFalsy();
  });

  it('loop_update_state writes STATE.md', async () => {
    const client = await connectClient('t1');
    await client.callTool({ name: 'loop_update_state', arguments: { content: '# new state' } });
    expect(LoopService.writeState).toHaveBeenCalledWith('/wt/t1', '# new state');
  });

  it('loop_pause drives the controller at L2', async () => {
    const client = await connectClient('t1');
    const res = await client.callTool({ name: 'loop_pause', arguments: {} });
    expect(loopController.pause).toHaveBeenCalledWith('t1');
    expect((res as { isError?: boolean }).isError).toBeFalsy();
  });

  it('gates pause/kill behind level — L1 is human-only', async () => {
    runningLoop('L1');
    const client = await connectClient('t1');

    const pause = await client.callTool({ name: 'loop_pause', arguments: {} });
    const kill = await client.callTool({ name: 'loop_kill', arguments: {} });

    expect((pause as { isError?: boolean }).isError).toBe(true);
    expect(textOf(pause as never)).toMatch(/human-only/);
    expect(loopController.pause).not.toHaveBeenCalled();
    expect((kill as { isError?: boolean }).isError).toBe(true);
    expect(loopController.stop).not.toHaveBeenCalled();
  });

  it('steer is allowed even at L1', async () => {
    runningLoop('L1');
    const client = await connectClient('t1');
    const res = await client.callTool({ name: 'loop_steer', arguments: { message: 'hi' } });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    expect(LoopService.appendManagerNotes).toHaveBeenCalled();
  });

  it('can construct the stateless streamable-HTTP transport (deps load at runtime)', () => {
    // handleLoopMcpRequest uses this transport; constructing it proves the SDK's
    // @hono/node-server dependency chain resolves under Electron's Node.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    expect(transport).toBeTruthy();
    void transport.close();
  });

  it('reports an error when the loop is not running', async () => {
    vi.mocked(loopController.getContext).mockReturnValue(null);
    const client = await connectClient('t1');
    const res = await client.callTool({ name: 'loop_get_state', arguments: {} });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(textOf(res as never)).toMatch(/not running/);
  });
});
