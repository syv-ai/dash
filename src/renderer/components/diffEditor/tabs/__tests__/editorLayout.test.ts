import { describe, expect, it } from 'vitest';
import {
  EMPTY_LAYOUT,
  activateTab,
  activePath,
  closeTab,
  focusGroup,
  openPaths,
  openTab,
  parseLayout,
  serializeLayout,
  type EditorLayout,
} from '../editorLayout';

const open = (...paths: string[]) =>
  paths.reduce<EditorLayout>((l, p) => openTab(l, p), EMPTY_LAYOUT);

describe('openTab', () => {
  it('adds a tab right of the active one and activates it', () => {
    let l = open('a', 'b');
    l = activateTab(l, 0, 'a');
    l = openTab(l, 'c');
    expect(l.groups[0]).toEqual({ tabs: ['a', 'c', 'b'], active: 'c' });
  });

  it('activates a file already open instead of opening it twice', () => {
    const l = openTab(open('a', 'b'), 'a');
    expect(l.groups[0]).toEqual({ tabs: ['a', 'b'], active: 'a' });
  });

  it('opens to the side into a new second group and focuses it', () => {
    const l = openTab(open('a'), 'b', { toSide: true });
    expect(l.groups).toEqual([
      { tabs: ['a'], active: 'a' },
      { tabs: ['b'], active: 'b' },
    ]);
    expect(l.focused).toBe(1);
  });

  it('opens to the side of the second group into the first', () => {
    const l = openTab(openTab(open('a'), 'b', { toSide: true }), 'c', { toSide: true });
    expect(l.groups[0]!.tabs).toEqual(['a', 'c']);
    expect(l.focused).toBe(0);
    expect(l.groups).toHaveLength(2);
  });

  it('opens into the focused group', () => {
    let l = openTab(open('a'), 'b', { toSide: true });
    l = openTab(l, 'c');
    expect(l.groups[1]!.tabs).toEqual(['b', 'c']);
  });
});

describe('activateTab / focusGroup', () => {
  it("activates and focuses the tab's group", () => {
    let l = openTab(open('a', 'b'), 'c', { toSide: true });
    l = activateTab(l, 0, 'a');
    expect(l.focused).toBe(0);
    expect(activePath(l)).toBe('a');
  });

  it('ignores a path the group does not hold', () => {
    const l = open('a');
    expect(activateTab(l, 0, 'zz')).toBe(l);
    expect(activateTab(l, 1, 'a')).toBe(l);
  });

  it('focuses only an existing group', () => {
    const l = open('a');
    expect(focusGroup(l, 1)).toBe(l);
    const split = openTab(l, 'b', { toSide: true });
    expect(focusGroup(split, 0).focused).toBe(0);
  });
});

describe('closeTab', () => {
  it('activates the right neighbour, else the left', () => {
    let l = activateTab(open('a', 'b', 'c'), 0, 'b');
    l = closeTab(l, 0, 'b');
    expect(l.groups[0]).toEqual({ tabs: ['a', 'c'], active: 'c' });
    l = closeTab(l, 0, 'c');
    expect(l.groups[0]).toEqual({ tabs: ['a'], active: 'a' });
  });

  it('keeps the active tab when closing another', () => {
    const l = closeTab(open('a', 'b'), 0, 'a');
    expect(l.groups[0]).toEqual({ tabs: ['b'], active: 'b' });
  });

  it('leaves one empty group when the last tab closes', () => {
    expect(closeTab(open('a'), 0, 'a')).toEqual(EMPTY_LAYOUT);
  });

  it('collapses the split when the second group empties', () => {
    const l = closeTab(openTab(open('a'), 'b', { toSide: true }), 1, 'b');
    expect(l).toEqual({ groups: [{ tabs: ['a'], active: 'a' }], focused: 0 });
  });

  it('moves the second group into the first when the first empties', () => {
    const l = closeTab(openTab(open('a'), 'b', { toSide: true }), 0, 'a');
    expect(l).toEqual({ groups: [{ tabs: ['b'], active: 'b' }], focused: 0 });
  });
});

describe('openPaths', () => {
  it('lists each open file once across groups', () => {
    const l = openTab(open('a', 'b'), 'a', { toSide: true });
    expect(openPaths(l)).toEqual(['a', 'b']);
  });
});

describe('parseLayout', () => {
  it('round-trips a split layout', () => {
    const l = openTab(open('a', 'b'), 'c', { toSide: true });
    expect(parseLayout(serializeLayout(l))).toEqual(l);
  });

  it('rejects what is not a layout', () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout('{')).toBeNull();
    expect(parseLayout('{"groups":[]}')).toBeNull();
    expect(parseLayout('{"groups":[{},{},{}]}')).toBeNull();
    expect(parseLayout('{"groups":[{"tabs":"a"}]}')).toBeNull();
  });

  it('repairs a stale active tab, duplicates and an empty split', () => {
    const raw = JSON.stringify({
      groups: [
        { tabs: ['a', 'a', 3, 'b'], active: 'gone' },
        { tabs: [], active: null },
      ],
      focused: 1,
    });
    expect(parseLayout(raw)).toEqual({ groups: [{ tabs: ['a', 'b'], active: 'a' }], focused: 0 });
  });
});
