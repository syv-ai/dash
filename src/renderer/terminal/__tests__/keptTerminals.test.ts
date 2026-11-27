import { describe, expect, it } from 'vitest';
import { clampKeptReady, markViewed, pickEvictions } from '../keptTerminals';

const none = () => false;

/** Views `ids` in turn, then evicts past `keep`, as the registry does. */
function viewAll(ids: string[], keep: number, held: (id: string) => boolean = none) {
  let order: string[] = [];
  const evicted: string[] = [];
  for (const id of ids) {
    order = markViewed(order, id);
    const out = pickEvictions(order, keep, held);
    evicted.push(...out);
    order = order.filter((x) => !out.includes(x));
  }
  return { order, evicted };
}

describe('markViewed', () => {
  it('puts the viewed id first, once', () => {
    expect(markViewed(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(markViewed(['a', 'b'], 'a')).toEqual(['a', 'b']);
    expect(markViewed([], 'a')).toEqual(['a']);
  });
});

describe('pickEvictions', () => {
  it('evicts nothing at or under the count', () => {
    expect(pickEvictions(['a', 'b'], 2, none)).toEqual([]);
  });

  it('evicts every one past the most recent `keep`', () => {
    expect(pickEvictions(['e', 'd', 'c', 'b', 'a'], 3, none)).toEqual(['b', 'a']);
  });

  it('keeps a held one past the count, without counting another out', () => {
    expect(pickEvictions(['d', 'c', 'b', 'a'], 2, (id) => id === 'a')).toEqual(['b']);
  });
});

describe('the most-recently-viewed rule', () => {
  it('opening eight tasks keeps the last five and lets the first three go', () => {
    const { order, evicted } = viewAll(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'], 5);
    expect(order).toEqual(['t8', 't7', 't6', 't5', 't4']);
    expect(evicted).toEqual(['t1', 't2', 't3']);
  });

  it('switching back to a kept task keeps it and evicts nothing', () => {
    const { order, evicted } = viewAll(['t1', 't2', 't3', 't1'], 3);
    expect(order).toEqual(['t1', 't3', 't2']);
    expect(evicted).toEqual([]);
  });

  it('reopening an evicted task makes it the newest and lets the oldest go', () => {
    const { order, evicted } = viewAll(['t1', 't2', 't3', 't1'], 2);
    expect(evicted).toEqual(['t1', 't2']);
    expect(order).toEqual(['t1', 't3']);
  });

  it('a held task is kept until a later pass finds it free', () => {
    let held = true;
    const first = viewAll(['t1', 't2', 't3'], 2, (id) => held && id === 't1');
    expect(first.evicted).toEqual([]);
    held = false;
    expect(pickEvictions(first.order, 2, () => held)).toEqual(['t1']);
  });
});

describe('clampKeptReady', () => {
  it('clamps to 2..14, rounds, and falls back to 5', () => {
    expect(clampKeptReady(0)).toBe(2);
    expect(clampKeptReady(99)).toBe(14);
    expect(clampKeptReady(6.6)).toBe(7);
    expect(clampKeptReady(Number.NaN)).toBe(5);
  });
});
