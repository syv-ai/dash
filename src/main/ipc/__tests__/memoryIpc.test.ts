import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { memoryProjectArgsSchema } from '../memoryIpc';

describe('memoryProjectArgsSchema', () => {
  it('accepts an absolute project path', () => {
    expect(() => memoryProjectArgsSchema.parse({ projectPath: '/repos/dash' })).not.toThrow();
  });
  it('rejects a relative path', () => {
    expect(() => memoryProjectArgsSchema.parse({ projectPath: 'repos/dash' })).toThrow();
  });
  it('rejects a missing path', () => {
    expect(() => memoryProjectArgsSchema.parse({})).toThrow();
  });
});
