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
