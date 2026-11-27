import { describe, it, expect } from 'vitest';
import type { LinkedItem } from '../types';
import { buildTaskContext, formatTaskContextPrompt, relinkTaskContext } from '../taskContext';

const issue = (id: number): LinkedItem => ({
  provider: 'github',
  id,
  title: `Issue ${id}`,
  url: `https://github.com/acme/app/issues/${id}`,
});

describe('relinkTaskContext', () => {
  it("replaces the old items' block, keeping the task's own context", () => {
    const stored = buildTaskContext('Use pnpm.', [issue(1)]);
    const next = relinkTaskContext(stored, [issue(1)], [issue(1), issue(2)]);
    expect(next).toBe(`Use pnpm.\n\n${formatTaskContextPrompt([issue(1), issue(2)])}`);
  });

  it('adds a block to a task that had no context or items', () => {
    expect(relinkTaskContext(null, [], [issue(3)])).toBe(formatTaskContextPrompt([issue(3)]));
    expect(relinkTaskContext('Be brief.', [], [issue(3)])).toBe(
      `Be brief.\n\n${formatTaskContextPrompt([issue(3)])}`,
    );
  });

  it('adds only the new items when the stored context no longer ends with the old block', () => {
    const stored = `${buildTaskContext('Use pnpm.', [issue(1)])}\n\nAlso: keep it small.`;
    const next = relinkTaskContext(stored, [issue(1)], [issue(1), issue(2)]);
    expect(next).toBe(`${stored}\n\n${formatTaskContextPrompt([issue(2)])}`);
    expect(next.split('Issue 1').length - 1).toBe(1);
  });
});

describe('formatTaskContextPrompt', () => {
  it('gives the items and no ask of its own: the person writes that', () => {
    const block = formatTaskContextPrompt([
      { ...issue(1), body: 'Login fails on Safari.' } as LinkedItem,
    ]);
    expect(block).toBe(
      "I'm working on the following GitHub issue(s):\n\n## Issue #1: Issue 1\nLogin fails on Safari.",
    );
  });

  it('puts the context prompt first, so a slash command in it leads the message', () => {
    expect(buildTaskContext('/review ', [issue(1)])).toMatch(/^\/review\n\n/);
  });
});
