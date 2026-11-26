import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Dot, type DotTone } from '../Dot';

const classes = (tone: DotTone, pulse?: boolean) =>
  (Dot({ tone, pulse }) as ReactElement<{ className: string }>).props.className.split(' ');

describe('Dot (H4)', () => {
  it('draws a neutral dot on the icon token, a failure on state-fail', () => {
    expect(classes('neutral')).toContain('bg-icon');
    expect(classes('fail')).toContain('bg-state-fail');
  });

  it('never wears an agent colour other than failure', () => {
    for (const tone of ['neutral', 'fail'] as const) {
      for (const c of ['bg-state-work', 'bg-state-needs', 'bg-state-unseen', 'bg-state-done'])
        expect(classes(tone)).not.toContain(c);
    }
  });

  it('breathes only when asked', () => {
    expect(classes('neutral')).not.toContain('motion-safe:animate-breathe');
    expect(classes('neutral', true)).toContain('motion-safe:animate-breathe');
  });
});
