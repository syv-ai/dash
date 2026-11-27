/*
 * The two letters that name a live session on the app sidebar's rail, under
 * its dot: pure, so the rules are tested without a DOM.
 *
 * A task's initials are the first letters of its name's first two words
 * ("smoke-review" → "sr", "r15-live-review" → "rl"), or a one-word name's
 * first two letters ("dashboard" → "da"); lower case, as names are written.
 * Where two sessions on the rail would read the same, the oldest task keeps
 * them, and each younger one takes its next pair: its first letter with the
 * next word's initial, then with each later letter of its name in turn
 * ("smoke-rerun" beside "smoke-review" → "sm"), then with a digit ("s2").
 * So a session's initials depend on which others are on the rail, never on
 * the rail's order, and don't move as sessions change state.
 */

/** What the initials are drawn from: a task's id, name and age. */
export interface Named {
  id: string;
  name: string;
  /** ISO time; the older of two that collide keeps its initials. */
  createdAt: string;
}

/** A name's words: its runs of letters and digits, lower case. */
function words(name: string): string[] {
  return name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * A name's initials, best first: the first letter with the next word's
 * initials, then with each later letter of the name; deduplicated. A name of
 * one letter gives that letter alone, one with none at all a "?".
 */
export function initialsCandidates(name: string): string[] {
  const ws = words(name);
  const [lead, ...letters] = ws.join('');
  if (!lead) return ['?'];
  const seconds = [...ws.slice(1).map((w) => w.charAt(0)), ...letters];
  if (seconds.length === 0) return [lead];
  return [...new Set(seconds.map((c) => lead + c))];
}

/** Oldest first; the id breaks ties, so the order is always the same. */
function byAge(a: Named, b: Named): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Each task's initials (by id), distinct across `tasks` where its name
 * allows: those whose first pair is theirs alone keep it; where several
 * share one, the oldest keeps it and the others take, oldest first, their
 * next pair no task holds, else their first letter with a digit from 2.
 */
export function railInitials(tasks: readonly Named[]): Map<string, string> {
  const candidates = new Map(tasks.map((t) => [t.id, initialsCandidates(t.name)]));
  const optionsOf = (t: Named) => candidates.get(t.id) ?? ['?'];
  const byFirst = new Map<string, Named[]>();
  for (const t of tasks) {
    const [pair = '?'] = optionsOf(t);
    byFirst.set(pair, [...(byFirst.get(pair) ?? []), t]);
  }

  const result = new Map<string, string>();
  const taken = new Set<string>();
  const younger: Named[] = [];
  // Every first pair is held before any younger task picks, so a pick never
  // takes a pair another task reads as its own.
  for (const [pair, group] of byFirst) {
    const [oldest, ...others] = [...group].sort(byAge);
    if (!oldest) continue;
    result.set(oldest.id, pair);
    taken.add(pair);
    younger.push(...others);
  }
  for (const t of younger.sort(byAge)) {
    const options = optionsOf(t);
    let pick = options.find((c) => !taken.has(c));
    for (let n = 2; !pick; n++) {
      const numbered = (options[0]?.charAt(0) ?? '?') + n;
      if (!taken.has(numbered)) pick = numbered;
    }
    result.set(t.id, pick);
    taken.add(pick);
  }
  return result;
}
