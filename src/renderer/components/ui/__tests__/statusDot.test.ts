import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { StatusDot, type AgentState } from '../StatusDot';

// The classes StatusDot renders, without a DOM.
const classes = (state: AgentState) =>
  (StatusDot({ state }) as ReactElement<{ className: string }>).props.className.split(' ');

describe('StatusDot', () => {
  it('draws a live session at rest green, the resting state', () => {
    expect(classes('idle')).toContain('bg-state-done');
  });

  it('tells done-but-unseen apart from at rest by a halo of the same green', () => {
    expect(classes('done')).toContain('bg-state-done');
    expect(classes('done').some((c) => c.startsWith('ring-state-done'))).toBe(true);
    expect(classes('idle').some((c) => c.startsWith('ring'))).toBe(false);
  });

  it('keeps the slot but draws nothing without a live session', () => {
    expect(classes('asleep')).toContain('invisible');
  });

  it('breathes only while working', () => {
    expect(classes('work')).toContain('motion-safe:animate-breathe');
    for (const s of ['needs', 'fail', 'done', 'idle'] as const)
      expect(classes(s)).not.toContain('motion-safe:animate-breathe');
  });
});
