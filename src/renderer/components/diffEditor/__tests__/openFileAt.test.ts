import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installWindow,
  makeElectronApiMock,
  resetWindow,
} from '../../../stores/__tests__/helpers/electronApiMock';
import type { Task } from '../../../../shared/types';

// The stores pull in renderer-only modules; stub them like the store tests do.
vi.mock('../../../terminal/SessionRegistry', () => ({
  sessionRegistry: { dispose: vi.fn(), disposeByPrefix: vi.fn(), restartAllForTask: vi.fn() },
}));
vi.mock('../../ui/toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../sounds', () => ({ playPeonSound: vi.fn(), playNotificationSound: vi.fn() }));

const task = { id: 't1', projectId: 'p1', path: '/wt/t1', archivedAt: null } as Task;
const range = { startLineNumber: 4, startColumn: 2, endLineNumber: 4, endColumn: 8 };

async function load() {
  vi.resetModules();
  const { useProjects } = await import('../../../stores/projectsStore');
  const { useEditors } = await import('../../../stores/editorsStore');
  const { useEditorTabs } = await import('../../../stores/editorTabsStore');
  const { openFileAt } = await import('../openFileAt');
  useProjects.setState({
    tasksByProject: { p1: [task] },
    activeProjectId: 'p1',
    activeTaskId: 't1',
  });
  return { useEditors, useEditorTabs, openFileAt };
}

beforeEach(() => installWindow(makeElectronApiMock()));
afterEach(() => resetWindow());

describe('openFileAt', () => {
  it('opens an absolute path in the worktree as a tab, reveals it, and opens the editor', async () => {
    const { useEditors, useEditorTabs, openFileAt } = await load();
    expect(openFileAt('/wt/t1/src/a.ts', range)).toBe(true);

    const tabs = useEditorTabs.getState();
    expect(tabs.layouts.t1!.groups[0]).toEqual({
      tabs: ['src/a.ts'],
      active: 'src/a.ts',
      preview: 'src/a.ts',
    });
    expect(tabs.reveal).toMatchObject({ key: 't1', path: 'src/a.ts', range });
    expect(useEditors.getState().byCwd['/wt/t1']).toEqual({
      target: { cwd: '/wt/t1', filePath: '' },
      hidden: false,
    });
  });

  it('takes a worktree-relative path and leaves an open editor be', async () => {
    const { useEditors, useEditorTabs, openFileAt } = await load();
    useEditors.getState().open({ cwd: '/wt/t1', filePath: 'x.ts' });
    const open = useEditors.getState().byCwd['/wt/t1'];
    expect(openFileAt('b.ts')).toBe(true);
    expect(useEditorTabs.getState().layouts.t1!.groups[0]!.active).toBe('b.ts');
    expect(useEditorTabs.getState().reveal).toBeNull();
    expect(useEditors.getState().byCwd['/wt/t1']).toBe(open);
  });

  it('refuses a file outside the worktree', async () => {
    const { useEditors, openFileAt } = await load();
    expect(openFileAt('/wt/t10/a.ts')).toBe(false);
    expect(openFileAt('/usr/lib/x.d.ts', range)).toBe(false);
    expect(useEditors.getState().byCwd).toEqual({});
  });

  it('expands a narrow sidebar whose editor is hidden', async () => {
    const { useEditors, openFileAt } = await load();
    useEditors.getState().open({ cwd: '/wt/t1', filePath: 'x.ts' });
    useEditors.getState().hide('/wt/t1');
    expect(openFileAt('b.ts', range)).toBe(true);
    expect(useEditors.getState().byCwd['/wt/t1']?.hidden).toBe(false);
  });
});
