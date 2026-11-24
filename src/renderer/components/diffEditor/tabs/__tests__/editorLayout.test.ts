import { describe, expect, it } from 'vitest';
import {
  EMPTY_LAYOUT,
  activateTab,
  activePath,
  closeTab,
  closeTabs,
  focusGroup,
  openPaths,
  openTab,
  parseLayout,
  pinTab,
  retainTabs,
  serializeLayout,
  tabsInScope,
  type EditorLayout,
} from '../editorLayout';

const open = (...paths: string[]) =>
  paths.reduce<EditorLayout>((l, p) => openTab(l, p), EMPTY_LAYOUT);

describe('openTab', () => {
  it('adds a tab right of the active one and activates it', () => {
    let l = open('a', 'b');
    l = activateTab(l, 0, 'a');
    l = openTab(l, 'c');
    expect(l.groups[0]).toEqual({ tabs: ['a', 'c', 'b'], active: 'c', preview: null });
  });

  it('adds a background tab at the end without activating it', () => {
    const l = openTab(activateTab(open('a', 'b'), 0, 'a'), 'c', { background: true });
    expect(l.groups[0]).toEqual({ tabs: ['a', 'b', 'c'], active: 'a', preview: null });
    expect(openTab(l, 'b', { background: true })).toBe(l);
    expect(openTab(EMPTY_LAYOUT, 'x', { background: true }).groups[0]).toEqual({
      tabs: ['x'],
      active: 'x',
      preview: null,
    });
  });

  it('activates a file already open instead of opening it twice', () => {
    const l = openTab(open('a', 'b'), 'a');
    expect(l.groups[0]).toEqual({ tabs: ['a', 'b'], active: 'a', preview: null });
  });

  it('opens to the side into a new second group and focuses it', () => {
    const l = openTab(open('a'), 'b', { toSide: true });
    expect(l.groups).toEqual([
      { tabs: ['a'], active: 'a', preview: null },
      { tabs: ['b'], active: 'b', preview: null },
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

describe('two panes: open in new pane, plain open to the last focused', () => {
  // Two panes: 'a' left, 'b' right; the right one was focused last.
  const split = () => openTab(open('a'), 'b', { toSide: true });

  it('opens in a new pane as a kept tab, focusing it', () => {
    const l = openTab(open('a'), 'b', { toSide: true });
    expect(l.groups).toHaveLength(2);
    expect(l.groups[1]).toEqual({ tabs: ['b'], active: 'b', preview: null });
    expect(l.focused).toBe(1);
  });

  it('with two panes, "open in new pane" goes to the pane that is not focused', () => {
    const l = openTab(split(), 'c', { toSide: true });
    expect(l.groups[0]!.tabs).toEqual(['a', 'c']);
    expect(l.groups[1]!.tabs).toEqual(['b']);
    expect(l.focused).toBe(0);
    expect(l.groups).toHaveLength(2);
  });

  it('a plain open lands in the last focused pane', () => {
    let l = openTab(split(), 'c', { preview: true });
    expect(l.groups[1]).toEqual({ tabs: ['b', 'c'], active: 'c', preview: 'c' });
    l = openTab(focusGroup(l, 0), 'd', { preview: true });
    expect(l.groups[0]).toEqual({ tabs: ['a', 'd'], active: 'd', preview: 'd' });
    expect(l.focused).toBe(0);
  });

  it('activating a tab makes its pane the last focused', () => {
    const l = openTab(activateTab(split(), 0, 'a'), 'c');
    expect(l.groups[0]!.tabs).toEqual(['a', 'c']);
    expect(l.groups[1]!.tabs).toEqual(['b']);
  });

  it('a file open in the other pane opens again in the focused one', () => {
    const l = openTab(split(), 'a');
    expect(l.groups[1]!.tabs).toEqual(['b', 'a']);
    expect(l.groups[0]!.tabs).toEqual(['a']);
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
    expect(l.groups[0]).toEqual({ tabs: ['a', 'c'], active: 'c', preview: null });
    l = closeTab(l, 0, 'c');
    expect(l.groups[0]).toEqual({ tabs: ['a'], active: 'a', preview: null });
  });

  it('keeps the active tab when closing another', () => {
    const l = closeTab(open('a', 'b'), 0, 'a');
    expect(l.groups[0]).toEqual({ tabs: ['b'], active: 'b', preview: null });
  });

  it('leaves one empty group when the last tab closes', () => {
    expect(closeTab(open('a'), 0, 'a')).toEqual(EMPTY_LAYOUT);
  });

  it('collapses the split when the second group empties', () => {
    const l = closeTab(openTab(open('a'), 'b', { toSide: true }), 1, 'b');
    expect(l).toEqual({ groups: [{ tabs: ['a'], active: 'a', preview: null }], focused: 0 });
  });

  it('moves the second group into the first when the first empties', () => {
    const l = closeTab(openTab(open('a'), 'b', { toSide: true }), 0, 'a');
    expect(l).toEqual({ groups: [{ tabs: ['b'], active: 'b', preview: null }], focused: 0 });
  });
});

describe('tabsInScope / closeTabs', () => {
  const l = open('a', 'b', 'c', 'd');

  it('names the tabs each close command takes', () => {
    const tabs = l.groups[0]!.tabs;
    expect(tabsInScope(tabs, 'b', 'others')).toEqual(['a', 'c', 'd']);
    expect(tabsInScope(tabs, 'b', 'right')).toEqual(['c', 'd']);
    expect(tabsInScope(tabs, 'b', 'all')).toEqual(['a', 'b', 'c', 'd']);
    expect(tabsInScope(tabs, 'd', 'right')).toEqual([]);
    expect(tabsInScope(tabs, 'zz', 'all')).toEqual([]);
  });

  it('closes others, leaving the tab active', () => {
    const next = closeTabs(l, 0, tabsInScope(l.groups[0]!.tabs, 'b', 'others'));
    expect(next.groups[0]).toEqual({ tabs: ['b'], active: 'b', preview: null });
  });

  it('closes to the right; an active tab among them hands over to the left', () => {
    const next = closeTabs(l, 0, tabsInScope(l.groups[0]!.tabs, 'b', 'right'));
    expect(next.groups[0]).toEqual({ tabs: ['a', 'b'], active: 'b', preview: null });
  });

  it('closing all of the first pane collapses the split onto the second', () => {
    const split = openTab(l, 'x', { toSide: true });
    const next = closeTabs(split, 0, tabsInScope(split.groups[0]!.tabs, 'a', 'all'));
    expect(next).toEqual({ groups: [{ tabs: ['x'], active: 'x', preview: null }], focused: 0 });
  });

  it('closing all of the only pane leaves it empty', () => {
    expect(closeTabs(l, 0, tabsInScope(l.groups[0]!.tabs, 'a', 'all'))).toEqual(EMPTY_LAYOUT);
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
        { tabs: ['a', 'a', 3, 'b'], active: 'gone', preview: null },
        { tabs: [], active: null, preview: null },
      ],
      focused: 1,
    });
    expect(parseLayout(raw)).toEqual({
      groups: [{ tabs: ['a', 'b'], active: 'a', preview: null }],
      focused: 0,
    });
  });
});

describe('preview tabs', () => {
  const peek = (l: EditorLayout, p: string) => openTab(l, p, { preview: true });

  it('opens a preview tab that the next preview open replaces in place', () => {
    let l = peek(open('a'), 'b');
    expect(l.groups[0]).toEqual({ tabs: ['a', 'b'], active: 'b', preview: 'b' });
    l = peek(activateTab(l, 0, 'a'), 'c');
    expect(l.groups[0]).toEqual({ tabs: ['a', 'c'], active: 'c', preview: 'c' });
  });

  it('keeps one preview tab per group', () => {
    let l = peek(open('a'), 'b');
    l = openTab(l, 'c', { toSide: true, preview: true });
    l = openTab(l, 'd', { toSide: true, preview: true });
    expect(l.groups[0]).toEqual({ tabs: ['a', 'd'], active: 'd', preview: 'd' });
    expect(l.groups[1]).toEqual({ tabs: ['c'], active: 'c', preview: 'c' });
  });

  it('activates a file already open without making it a preview', () => {
    const l = peek(peek(open('a'), 'b'), 'a');
    expect(l.groups[0]).toEqual({ tabs: ['a', 'b'], active: 'a', preview: 'b' });
  });

  it('keeps the preview tab when it is opened for good', () => {
    const l = openTab(peek(open('a'), 'b'), 'b');
    expect(l.groups[0]).toEqual({ tabs: ['a', 'b'], active: 'b', preview: null });
    expect(peek(l, 'c').groups[0]!.tabs).toEqual(['a', 'b', 'c']);
  });

  it('pins the preview tab', () => {
    const l = peek(open('a'), 'b');
    expect(pinTab(l, 0, 'b').groups[0]!.preview).toBeNull();
    expect(pinTab(l, 0, 'a')).toBe(l);
    expect(pinTab(l, 1, 'b')).toBe(l);
  });

  it('forgets the preview when its tab closes', () => {
    const l = closeTab(peek(open('a'), 'b'), 0, 'b');
    expect(l.groups[0]).toEqual({ tabs: ['a'], active: 'a', preview: null });
  });

  it('opens a background tab as a kept tab', () => {
    const l = openTab(peek(open('a'), 'b'), 'c', { background: true });
    expect(l.groups[0]).toEqual({ tabs: ['a', 'b', 'c'], active: 'b', preview: 'b' });
  });

  it('round-trips and repairs the preview', () => {
    const l = peek(open('a'), 'b');
    expect(parseLayout(serializeLayout(l))).toEqual(l);
    const raw = JSON.stringify({ groups: [{ tabs: ['a'], active: 'a', preview: 'gone' }] });
    expect(parseLayout(raw)!.groups[0]!.preview).toBeNull();
  });
});

describe('retainTabs', () => {
  it('closes the tabs turned down, across groups, with closeTab semantics', () => {
    let l = openTab(open('a', 'b', 'c'), 'd', { toSide: true, preview: true });
    l = retainTabs(l, (p) => p === 'a' || p === 'c');
    expect(l).toEqual({ groups: [{ tabs: ['a', 'c'], active: 'c', preview: null }], focused: 0 });
  });

  it('tells keep which tab is the preview', () => {
    const l = openTab(open('a'), 'b', { preview: true });
    const seen: [string, boolean][] = [];
    expect(retainTabs(l, (p, preview) => (seen.push([p, preview]), true))).toBe(l);
    expect(seen).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });
});
