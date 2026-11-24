/*
 * The editor's tabs and groups, as plain data: at most two groups side by
 * side, each an ordered list of open files (repo-relative paths) with one
 * active. Pure, so the rules are tested without a DOM; the store applies them.
 */

export type GroupIndex = 0 | 1;

export interface EditorGroup {
  tabs: string[];
  active: string | null;
}

export interface EditorLayout {
  /** One group, or two side by side. */
  groups: EditorGroup[];
  /** The group keyboard and "open" act on. */
  focused: GroupIndex;
}

export const EMPTY_LAYOUT: EditorLayout = { groups: [{ tabs: [], active: null }], focused: 0 };

const MAX_GROUPS = 2;

function withGroup(layout: EditorLayout, index: number, group: EditorGroup): EditorGroup[] {
  return layout.groups.map((g, i) => (i === index ? group : g));
}

/** Open `path` in a group and make it active: the focused group, or with
 *  `toSide` the other one (split first if there is only one). A file already
 *  open in that group is activated, not opened twice; a new tab goes right of
 *  the active one. With `background` the tab is only added (the group keeps
 *  its active file, unless it had none). */
export function openTab(
  layout: EditorLayout,
  path: string,
  opts: { toSide?: boolean; background?: boolean } = {},
): EditorLayout {
  if (opts.background) {
    const group = layout.groups[layout.focused]!;
    if (group.tabs.includes(path)) return layout;
    const tabs = [...group.tabs, path];
    return {
      ...layout,
      groups: withGroup(layout, layout.focused, { tabs, active: group.active ?? path }),
    };
  }
  let groups = layout.groups;
  let target: GroupIndex = layout.focused;
  if (opts.toSide) {
    if (groups.length < MAX_GROUPS) groups = [...groups, { tabs: [], active: null }];
    target = layout.focused === 0 ? 1 : 0;
  }
  const group = groups[target]!;
  if (group.tabs.includes(path)) {
    const next = { ...layout, groups };
    return {
      ...next,
      groups: withGroup(next, target, { ...group, active: path }),
      focused: target,
    };
  }
  const at = group.active ? group.tabs.indexOf(group.active) + 1 : group.tabs.length;
  const tabs = [...group.tabs.slice(0, at), path, ...group.tabs.slice(at)];
  const next = { ...layout, groups };
  return { ...next, groups: withGroup(next, target, { tabs, active: path }), focused: target };
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
  return { ...layout, groups: withGroup(layout, group, { tabs, active }) };
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
    const g = raw as { tabs?: unknown; active?: unknown };
    if (!g || !Array.isArray(g.tabs)) return null;
    const tabs = [...new Set(g.tabs.filter((t): t is string => typeof t === 'string' && !!t))];
    const active = typeof g.active === 'string' && tabs.includes(g.active) ? g.active : null;
    groups.push({ tabs, active: active ?? tabs[0] ?? null });
  }
  // An empty group is a split nothing is open in: drop it (keeping one).
  const nonEmpty = groups.filter((g) => g.tabs.length > 0);
  const kept = nonEmpty.length > 0 ? nonEmpty : [{ tabs: [], active: null }];
  const focused: GroupIndex = o.focused === 1 && kept.length > 1 ? 1 : 0;
  return { groups: kept, focused };
}

export function serializeLayout(layout: EditorLayout): string {
  return JSON.stringify(layout);
}
