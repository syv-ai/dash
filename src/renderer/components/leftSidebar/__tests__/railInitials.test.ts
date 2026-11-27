import { describe, it, expect } from 'vitest';
import { initialsCandidates, railInitials, type Named } from '../railInitials';

const task = (id: string, name: string, createdAt = '2026-11-01T00:00:00Z'): Named => ({
  id,
  name,
  createdAt,
});

const initialsOf = (tasks: Named[]) => Object.fromEntries(railInitials(tasks));

describe('initialsCandidates', () => {
  it("takes the first two words' initials first, whatever separates them", () => {
    expect(initialsCandidates('smoke-review')[0]).toBe('sr');
    expect(initialsCandidates('r15-live-review')[0]).toBe('rl');
    expect(initialsCandidates('Fix the login')[0]).toBe('ft');
    expect(initialsCandidates('feat/search_files')[0]).toBe('fs');
  });

  it("takes a one-word name's first two letters", () => {
    expect(initialsCandidates('dashboard')[0]).toBe('da');
  });

  it("then the later words' initials, then each later letter, without repeats", () => {
    expect(initialsCandidates('ab-cd')).toEqual(['ac', 'ab', 'ad']);
  });

  it('gives one letter alone, and a "?" for a name with none', () => {
    expect(initialsCandidates('x')).toEqual(['x']);
    expect(initialsCandidates('--')).toEqual(['?']);
  });
});

describe('railInitials', () => {
  it('gives each task its first pair when no other shares it', () => {
    expect(initialsOf([task('a', 'smoke-review'), task('b', 'r15-live-review')])).toEqual({
      a: 'sr',
      b: 'rl',
    });
  });

  it('lets the oldest keep a shared pair, and the younger take its next free one', () => {
    const older = task('b', 'smoke-review', '2026-11-01T00:00:00Z');
    const younger = task('a', 'smoke-rerun', '2026-11-02T00:00:00Z');
    expect(initialsOf([younger, older])).toEqual({ b: 'sr', a: 'sm' });
  });

  it("is the same whatever the rail's order", () => {
    const tasks = [task('a', 'smoke-review'), task('b', 'smoke-rerun'), task('c', 'slow-run')];
    expect(initialsOf(tasks)).toEqual(initialsOf([...tasks].reverse()));
  });

  it('never takes a pair another task has as its first', () => {
    // "sm" is c's own first pair, so the younger "smoke-rerun" skips it.
    const tasks = [
      task('a', 'smoke-review', '2026-11-01T00:00:00Z'),
      task('b', 'smoke-rerun', '2026-11-02T00:00:00Z'),
      task('c', 'small-mess', '2026-11-03T00:00:00Z'),
    ];
    expect(initialsOf(tasks)).toEqual({ a: 'sr', b: 'so', c: 'sm' });
  });

  it('numbers a name with no pair left', () => {
    const tasks = [
      task('a', 'xy', '2026-11-01T00:00:00Z'),
      task('b', 'xy', '2026-11-02T00:00:00Z'),
      task('c', 'xy', '2026-11-03T00:00:00Z'),
    ];
    expect(initialsOf(tasks)).toEqual({ a: 'xy', b: 'x2', c: 'x3' });
  });
});
