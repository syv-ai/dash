import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}));

const db = vi.hoisted(() => ({
  getTasks: vi.fn((_projectId: string) => [{ id: 't1' }, { id: 't2' }]),
  deleteProject: vi.fn(),
}));
vi.mock('../../services/DatabaseService', () => ({ DatabaseService: db }));
vi.mock('../../services/TelemetryService', () => ({ TelemetryService: { capture: () => {} } }));
vi.mock('../../services/ptyManager', () => ({ stopTaskSession: async () => {} }));

const removeTaskMcpConfig = vi.hoisted(() => vi.fn((_id: string) => {}));
vi.mock('../../control/mcpConfig', () => ({ removeTaskMcpConfig }));

import { registerDbIpc } from '../dbIpc';

registerDbIpc();
const deleteProject = (id: string) => handlers.get('db:deleteProject')!({}, id);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('db:deleteProject', () => {
  it("removes each task's mcp-config with the project", async () => {
    expect(await deleteProject('p1')).toEqual({ success: true });
    expect(db.getTasks).toHaveBeenCalledWith('p1');
    expect(removeTaskMcpConfig.mock.calls).toEqual([['t1'], ['t2']]);
    expect(db.deleteProject).toHaveBeenCalledWith('p1');
  });

  it('still deletes the project when a config removal fails', async () => {
    removeTaskMcpConfig.mockImplementationOnce(() => {
      throw new Error('EACCES');
    });
    expect(await deleteProject('p1')).toEqual({ success: true });
    expect(removeTaskMcpConfig).toHaveBeenCalledTimes(2);
    expect(db.deleteProject).toHaveBeenCalledWith('p1');
  });
});
