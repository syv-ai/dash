import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installWindow, makeElectronApiMock, resetWindow } from './helpers/electronApiMock';
import { selectLayout, useEditorTabs } from '../editorTabsStore';

type Storage = ReturnType<typeof installWindow>;
let storage: Storage;

beforeEach(() => {
  storage = installWindow(makeElectronApiMock());
  useEditorTabs.setState({ layouts: {}, reveal: null });
});

afterEach(() => resetWindow());

const layoutOf = (key: string) => selectLayout(key)(useEditorTabs.getState());

describe('editorTabsStore', () => {
  it('persists a task workspace and restores it', () => {
    const s = useEditorTabs.getState();
    s.load('task-1', true);
    s.open('task-1', 'src/a.ts');
    s.open('task-1', 'src/b.ts', { toSide: true });
    const saved = layoutOf('task-1');

    useEditorTabs.setState({ layouts: {} });
    useEditorTabs.getState().load('task-1', true);
    expect(layoutOf('task-1')).toEqual(saved);
    expect(saved.groups).toHaveLength(2);
  });

  it('does not persist a workspace loaded without persistence', () => {
    const s = useEditorTabs.getState();
    s.load('/tmp/memory', false);
    s.open('/tmp/memory', 'MEMORY.md');
    expect(storage.getItem('dash:editor-tabs:/tmp/memory')).toBeNull();
  });

  it('opens at a range and asks the focused group to reveal it, once', () => {
    const s = useEditorTabs.getState();
    s.load('task-2', false);
    s.open('task-2', 'a.ts');
    s.open('task-2', 'b.ts', { toSide: true });
    const range = { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 9 };
    s.openAt('task-2', 'c.ts', range);

    const reveal = useEditorTabs.getState().reveal!;
    expect(reveal).toMatchObject({ key: 'task-2', group: 1, path: 'c.ts', range });
    expect(layoutOf('task-2').groups[1]!.active).toBe('c.ts');

    useEditorTabs.getState().clearReveal(reveal.nonce + 1);
    expect(useEditorTabs.getState().reveal).not.toBeNull();
    useEditorTabs.getState().clearReveal(reveal.nonce);
    expect(useEditorTabs.getState().reveal).toBeNull();
  });
});
