import { vi } from 'vitest';
import { createMemoryStorage, type StorageLike } from '../../fanOutStorage';

/** A vi.fn-backed stand-in for window.electronAPI; add/override methods per test. */
export function makeElectronApiMock(overrides: Record<string, unknown> = {}) {
  // Loosely typed so tests can mockResolvedValue arbitrary IpcResponse shapes
  // (success/error/data) without fighting narrow inferred return types.
  const ok = (data?: unknown): Promise<any> => Promise.resolve({ success: true, data });
  return {
    getProjects: vi.fn(() => ok([])),
    getTasks: vi.fn(() => ok([])),
    saveProject: vi.fn(),
    deleteProject: vi.fn(() => ok(undefined)),
    showOpenDialog: vi.fn(() => ok([])),
    detectGit: vi.fn(() => ok({ isGitRepo: false, remote: null, branch: null })),
    gitClone: vi.fn(() => ok({ path: '', name: '' })),
    saveTask: vi.fn(),
    deleteTask: vi.fn(() => ok(undefined)),
    archiveTask: vi.fn(() => ok(undefined)),
    restoreTask: vi.fn(() => ok(undefined)),
    reorderTasks: vi.fn(() => ok(undefined)),
    worktreeClaimReserve: vi.fn((): Promise<any> => Promise.resolve({ success: false })),
    worktreeCreate: vi.fn(),
    worktreeCreateFromExisting: vi.fn(),
    worktreeRemove: vi.fn(() => ok(undefined)),
    worktreeEnsureReserve: vi.fn(() => ok(undefined)),
    gitCheckoutBranch: vi.fn(() => ok(undefined)),
    gitGetStatus: vi.fn(() => ok(null)),
    gitStageFiles: vi.fn(() => ok(undefined)),
    gitUnstageFiles: vi.fn(() => ok(undefined)),
    gitStageAll: vi.fn(() => ok(undefined)),
    gitUnstageAll: vi.fn(() => ok(undefined)),
    gitDiscardFiles: vi.fn(() => ok(undefined)),
    gitignoreAdd: vi.fn(() => ok(undefined)),
    gitCommit: vi.fn(() => ok(undefined)),
    gitPush: vi.fn(() => ok(undefined)),
    gitWatch: vi.fn(() => ok(undefined)),
    gitUnwatch: vi.fn(() => ok(undefined)),
    onGitFileChanged: vi.fn((_cb: (id: string) => void) => () => {}),
    githubGetPrForBranch: vi.fn(() => ok(null)),
    adoGetPrForBranch: vi.fn(() => ok(null)),
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
