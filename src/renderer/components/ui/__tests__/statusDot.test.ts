import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { StatusDot, type AgentState } from '../StatusDot';

// The classes StatusDot renders, without a DOM.
const classes = (state: AgentState) =>
  (StatusDot({ state }) as ReactElement<{ className: string }>).props.className.split(' ');

const BREATHE = 'motion-safe:animate-breathe';
const BREATHE_FEW = 'motion-safe:animate-breathe-few';

describe('StatusDot (S1)', () => {
  it('gives each state its own colour', () => {
    expect(classes('work')).toContain('bg-state-work');
    expect(classes('needs')).toContain('bg-state-needs');
    expect(classes('done')).toContain('bg-state-unseen');
    expect(classes('idle')).toContain('bg-state-done');
    expect(classes('fail')).toContain('bg-state-fail');
  });

  it('keeps the slot but draws nothing without a live session', () => {
    expect(classes('asleep')).toContain('invisible');
  });

  it('breathes on while working or waiting on you', () => {
    for (const s of ['work', 'needs'] as const) expect(classes(s)).toContain(BREATHE);
    for (const s of ['done', 'idle', 'fail', 'asleep'] as const)
      expect(classes(s)).not.toContain(BREATHE);
  });

  it('breathes a few times when finished unseen, then holds (D59)', () => {
    expect(classes('done')).toContain(BREATHE_FEW);
    for (const s of ['work', 'needs', 'idle', 'fail', 'asleep'] as const)
      expect(classes(s)).not.toContain(BREATHE_FEW);
  });

  it('wears no halo: colour and breath tell the states apart', () => {
    for (const s of ['work', 'needs', 'done', 'idle', 'fail'] as const)
      expect(classes(s).some((c) => c.startsWith('ring'))).toBe(false);
  });

  it('is 8px for a task and 6px for a roll-up (T20)', () => {
    expect(classes('work')).toContain('size-2');
    const sm = StatusDot({ state: 'work', size: 'sm' }) as ReactElement<{ className: string }>;
    expect(sm.props.className.split(' ')).toContain('size-1.5');
  });
});
