import { vi } from 'vitest';
import { createMemoryStorage, type StorageLike } from '../../fanOutStorage';

/** A vi.fn-backed stand-in for window.electronAPI; add/override methods per test. */
export function makeElectronApiMock(overrides: Record<string, unknown> = {}) {
  const ok = <T>(data: T) => Promise.resolve({ success: true, data });
  return {
    getProjects: vi.fn(() => ok([])),
    getTasks: vi.fn(() => ok([])),
    saveProject: vi.fn(),
    deleteProject: vi.fn(() => ok(undefined)),
    saveTask: vi.fn(),
    deleteTask: vi.fn(() => ok(undefined)),
    archiveTask: vi.fn(() => ok(undefined)),
    restoreTask: vi.fn(() => ok(undefined)),
    reorderTasks: vi.fn(() => ok(undefined)),
    worktreeClaimReserve: vi.fn(() => Promise.resolve({ success: false })),
    worktreeCreate: vi.fn(),
    worktreeCreateFromExisting: vi.fn(),
    worktreeRemove: vi.fn(() => ok(undefined)),
    worktreeEnsureReserve: vi.fn(() => ok(undefined)),
    gitCheckoutBranch: vi.fn(() => ok(undefined)),
    ptyKill: vi.fn(),
    ptyClearSnapshot: vi.fn(),
    ptyWriteTaskContext: vi.fn(() => ok(undefined)),
    getOrCreateDefaultConversation: vi.fn(() => ok({ id: 'conv1' })),
    githubPostBranchComment: vi.fn(() => ok(undefined)),
    adoPostBranchComment: vi.fn(() => ok(undefined)),
    ...overrides,
  };
}

/** Install a minimal window with electronAPI + memory localStorage onto globalThis.
 *  Returns the storage so tests can assert/seed keys. Call resetWindow() in afterEach. */
export function installWindow(electronAPI: ReturnType<typeof makeElectronApiMock>): StorageLike {
  const storage = createMemoryStorage();
  (globalThis as unknown as { window: unknown }).window = { electronAPI, localStorage: storage };
  return storage;
}

export function resetWindow() {
  delete (globalThis as unknown as { window?: unknown }).window;
}
