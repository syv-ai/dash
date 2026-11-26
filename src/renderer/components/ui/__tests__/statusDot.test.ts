import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { StatusDot, type AgentState } from '../StatusDot';

// The classes StatusDot renders, without a DOM.
const classes = (state: AgentState) =>
  (StatusDot({ state }) as ReactElement<{ className: string }>).props.className.split(' ');

const BREATHE = 'motion-safe:animate-breathe';

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

  it('breathes while it wants a look: working, waiting on you, finished unseen', () => {
    for (const s of ['work', 'needs', 'done'] as const) expect(classes(s)).toContain(BREATHE);
    for (const s of ['idle', 'fail', 'asleep'] as const) expect(classes(s)).not.toContain(BREATHE);
  });

  it('wears no halo: colour and breath tell the states apart', () => {
    for (const s of ['work', 'needs', 'done', 'idle', 'fail'] as const)
      expect(classes(s).some((c) => c.startsWith('ring'))).toBe(false);
  });
});
