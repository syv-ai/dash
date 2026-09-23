import { describe, it, expect } from 'vitest';
import {
  BlockSchema,
  DrawerSchema,
  button,
  code,
  iconAction,
  list,
  progress,
  row,
  text,
} from '../blocks';

describe('BlockSchema', () => {
  it('accepts every block the builders make', () => {
    const blocks = [
      text('hello'),
      text('bad', 'error'),
      row('web', { meta: ':3000', status: 'up', onClick: 'open:web' }),
      list([row('api', { actions: [iconAction('stop:api', 'square', 'Stop api')] })]),
      button('start', 'Start setup', { primary: true }),
      progress(),
      progress({ value: 0.5, label: 'Downloading' }),
      code('git status', 'Tested command'),
    ];
    for (const b of blocks) expect(BlockSchema.safeParse(b).success).toBe(true);
  });

  it('rejects unknown block types', () => {
    expect(BlockSchema.safeParse({ type: 'html', html: '<b>x</b>' }).success).toBe(false);
  });

  it('rejects icons outside the fixed list', () => {
    const bad = row('web', { actions: [{ id: 'x', icon: 'bomb' as never, tooltip: '' }] });
    expect(BlockSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a row without a label', () => {
    expect(BlockSchema.safeParse({ type: 'row' }).success).toBe(false);
  });

  it('rejects progress outside 0..1', () => {
    expect(BlockSchema.safeParse(progress({ value: 2 })).success).toBe(false);
  });
});

describe('DrawerSchema', () => {
  it('accepts a drawer with header actions', () => {
    const drawer = {
      title: 'Ports',
      summary: '1/2 up',
      actions: [iconAction('refresh', 'refresh-cw', 'Refresh')],
      blocks: [text('hi')],
    };
    expect(DrawerSchema.safeParse(drawer).success).toBe(true);
  });

  it('rejects a drawer without a title', () => {
    expect(DrawerSchema.safeParse({ blocks: [] }).success).toBe(false);
  });
});
