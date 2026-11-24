/*
 * The editor's tabs and groups, as plain data: at most two groups side by
 * side, each an ordered list of open files (repo-relative paths) with one
 * active. Pure, so the rules are tested without a DOM; the store applies them.
 *
 * Preview tabs work as in VS Code: a file opened in passing (a single click,
 * go to definition) takes the group's one preview tab, replacing whatever it
 * showed; editing it, double-clicking it or opening it for good keeps it.
 */

export type GroupIndex = 0 | 1;

export interface EditorGroup {
  tabs: string[];
  active: string | null;
  /** The tab the next preview open replaces (shown in italics), if any. */
  preview: string | null;
}

export interface EditorLayout {
  /** One group, or two side by side. */
  groups: EditorGroup[];
  /** The last focused group: the one keyboard and a plain "open" act on.
   *  Clicking or focusing into a group, activating a tab and opening a file
   *  all move it. */
  focused: GroupIndex;
}

const EMPTY_GROUP: EditorGroup = { tabs: [], active: null, preview: null };

export const EMPTY_LAYOUT: EditorLayout = { groups: [EMPTY_GROUP], focused: 0 };

export interface OpenOptions {
  /** "Open in new pane": the group that isn't focused, splitting first if
   *  there is only one. */
  toSide?: boolean;
  /** Only add the tab; the group keeps its active file. */
  background?: boolean;
  /** Open in passing: take the group's preview tab instead of a new one. */
  preview?: boolean;
}

const MAX_GROUPS = 2;

function withGroup(layout: EditorLayout, index: number, group: EditorGroup): EditorGroup[] {
  return layout.groups.map((g, i) => (i === index ? group : g));
}

/** Open `path` in a group and make it active: the focused group, or with
 *  `toSide` the other one (split first if there is only one). A file already
 *  open in that group is activated, not opened twice (and kept, unless this
 *  open is a preview too); a new tab goes right of the active one, or with
 *  `preview` replaces the group's preview tab. With `background` the tab is
 *  only added (the group keeps its active file, unless it had none). */
export function openTab(layout: EditorLayout, path: string, opts: OpenOptions = {}): EditorLayout {
  if (opts.background) {
    const group = layout.groups[layout.focused]!;
    if (group.tabs.includes(path)) return layout;
    const tabs = [...group.tabs, path];
    return {
      ...layout,
      groups: withGroup(layout, layout.focused, {
        ...group,
        tabs,
        active: group.active ?? path,
      }),
    };
  }
  let groups = layout.groups;
  let target: GroupIndex = layout.focused;
  if (opts.toSide) {
    if (groups.length < MAX_GROUPS) groups = [...groups, EMPTY_GROUP];
    target = layout.focused === 0 ? 1 : 0;
  }
  const next = { ...layout, groups, focused: target };
  const group = groups[target]!;
  if (group.tabs.includes(path)) {
    const preview = group.preview === path && !opts.preview ? null : group.preview;
    return { ...next, groups: withGroup(next, target, { ...group, active: path, preview }) };
  }
  if (opts.preview && group.preview) {
    const tabs = group.tabs.map((t) => (t === group.preview ? path : t));
    return {
      ...next,
      groups: withGroup(next, target, { tabs, active: path, preview: path }),
    };
  }
  const at = group.active ? group.tabs.indexOf(group.active) + 1 : group.tabs.length;
  const tabs = [...group.tabs.slice(0, at), path, ...group.tabs.slice(at)];
  return {
    ...next,
    groups: withGroup(next, target, {
      tabs,
      active: path,
      preview: opts.preview ? path : group.preview,
    }),
  };
}

/** Keep `path`'s tab in `group` open: it stops being the preview. */
export function pinTab(layout: EditorLayout, group: GroupIndex, path: string): EditorLayout {
  const g = layout.groups[group];
  if (!g || g.preview !== path) return layout;
  return { ...layout, groups: withGroup(layout, group, { ...g, preview: null }) };
}

/** Show `path`'s tab in `group` and focus that group. */
export function activateTab(layout: EditorLayout, group: GroupIndex, path: string): EditorLayout {
  const g = layout.groups[group];
  if (!g || !g.tabs.includes(path)) return layout;
  return { ...layout, groups: withGroup(layout, group, { ...g, active: path }), focused: group };
}

/** Close `path`'s tab in `group`. Its right neighbour (else left) becomes
 *  active; a second group left empty goes, collapsing the split. */
export function closeTab(layout: EditorLayout, group: GroupIndex, path: string): EditorLayout {
  const g = layout.groups[group];
  if (!g) return layout;
  const i = g.tabs.indexOf(path);
  if (i < 0) return layout;
  const tabs = g.tabs.filter((t) => t !== path);
  const active = g.active === path ? (tabs[i] ?? tabs[i - 1] ?? null) : g.active;
  if (tabs.length === 0 && layout.groups.length > 1) {
    return { groups: layout.groups.filter((_, j) => j !== group), focused: 0 };
  }
  const preview = g.preview === path ? null : g.preview;
  return { ...layout, groups: withGroup(layout, group, { tabs, active, preview }) };
}

/** Which of a group's tabs a "Close …" command takes, relative to `path`. */
export type CloseScope = 'others' | 'right' | 'all';

/** The tabs (a group's, in order) that `scope` closes, relative to `path`. */
export function tabsInScope(tabs: string[], path: string, scope: CloseScope): string[] {
  const i = tabs.indexOf(path);
  if (i < 0) return [];
  if (scope === 'all') return tabs;
  if (scope === 'right') return tabs.slice(i + 1);
  return tabs.filter((t) => t !== path);
}

/** Close `paths` in `group`, as `closeTab` would one by one. The group only
 *  collapses once its last tab goes, so the index stays valid throughout. */
export function closeTabs(layout: EditorLayout, group: GroupIndex, paths: string[]): EditorLayout {
  return paths.reduce((l, p) => closeTab(l, group, p), layout);
}

/** Close every tab `keep` turns down (told whether it is its group's
 *  preview), as `closeTab` would one by one. */
export function retainTabs(
  layout: EditorLayout,
  keep: (path: string, preview: boolean) => boolean,
): EditorLayout {
  let next = layout;
  // From the last group, so closing one that empties doesn't shift the rest.
  for (let gi = layout.groups.length - 1; gi >= 0; gi--) {
    const g = layout.groups[gi]!;
    for (const path of g.tabs) {
      if (!keep(path, g.preview === path)) next = closeTab(next, gi as GroupIndex, path);
    }
  }
  return next;
}

export function focusGroup(layout: EditorLayout, group: GroupIndex): EditorLayout {
  if (!layout.groups[group] || layout.focused === group) return layout;
  return { ...layout, focused: group };
}

/** The focused group's active file. */
export function activePath(layout: EditorLayout): string | null {
  return layout.groups[layout.focused]?.active ?? null;
}

/** Every open file, once. */
export function openPaths(layout: EditorLayout): string[] {
  return [...new Set(layout.groups.flatMap((g) => g.tabs))];
}

/** A stored layout, validated; null when it isn't one. */
export function parseLayout(raw: string | null): EditorLayout | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const o = value as { groups?: unknown; focused?: unknown };
  if (!Array.isArray(o.groups) || o.groups.length === 0 || o.groups.length > MAX_GROUPS) {
    return null;
  }
  const groups: EditorGroup[] = [];
  for (const raw of o.groups as unknown[]) {
    const g = raw as { tabs?: unknown; active?: unknown; preview?: unknown };
    if (!g || !Array.isArray(g.tabs)) return null;
    const tabs = [...new Set(g.tabs.filter((t): t is string => typeof t === 'string' && !!t))];
    const active = typeof g.active === 'string' && tabs.includes(g.active) ? g.active : null;
    const preview = typeof g.preview === 'string' && tabs.includes(g.preview) ? g.preview : null;
    groups.push({ tabs, active: active ?? tabs[0] ?? null, preview });
  }
  // An empty group is a split nothing is open in: drop it (keeping one).
  const nonEmpty = groups.filter((g) => g.tabs.length > 0);
  const kept = nonEmpty.length > 0 ? nonEmpty : [EMPTY_GROUP];
  const focused: GroupIndex = o.focused === 1 && kept.length > 1 ? 1 : 0;
  return { groups: kept, focused };
}

export function serializeLayout(layout: EditorLayout): string {
  return JSON.stringify(layout);
}
