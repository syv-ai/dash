import { describe, it, expect } from 'vitest';
import { DrawerSchema, type Block } from '@shared/addon-api';
import { buildDrawer, type DrawerInput } from '../drawer';
import type { TaskPort } from '../types';

function port(over: Partial<TaskPort>): TaskPort {
  return {
    id: 'x',
    taskId: 't1',
    label: 'web',
    envVar: 'WEB_PORT',
    defaultPort: 3000,
    hostPort: 3100,
    source: 'hash',
    runCommand: null,
    stopCommand: null,
    logsCommand: null,
    cwd: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const base: DrawerInput = {
  configured: false,
  heuristic: { signals: [], guesses: [] },
  setup: null,
  ports: [],
  liveness: {},
  owned: new Set(),
};

const buttons = (blocks: Block[]) =>
  blocks.filter((b) => b.type === 'button').map((b) => (b.type === 'button' ? b.id : ''));
const texts = (blocks: Block[]) =>
  blocks.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : ''));

describe('ports drawer', () => {
  it('always validates against the drawer schema', () => {
    const inputs: DrawerInput[] = [
      base,
      { ...base, setup: { kind: 'waiting', since: 0, errors: ['bad json'] } },
      { ...base, configured: true, ports: [port({ runCommand: 'pnpm dev' })] },
    ];
    for (const i of inputs) expect(DrawerSchema.safeParse(buildDrawer(i)).success).toBe(true);
  });

  it('not configured, services detected: names them and offers Start setup', () => {
    const d = buildDrawer({
      ...base,
      heuristic: {
        signals: ['vite (package.json)'],
        guesses: [{ label: 'web', envVar: 'WEB_PORT', defaultPort: 5173 }],
      },
    });
    expect(d.title).toBe('Ports');
    expect(texts(d.blocks)).toContain('Detected: vite (package.json)');
    expect(texts(d.blocks)).toContain('Likely services: web (WEB_PORT @ 5173)');
    expect(buttons(d.blocks)).toEqual(['start']);
  });

  it('not configured, nothing detected: explains and still offers Start setup', () => {
    const d = buildDrawer(base);
    expect(texts(d.blocks)[0]).toMatch(/own ports/);
    expect(buttons(d.blocks)).toEqual(['start']);
  });

  it('setup states take precedence over the offer', () => {
    expect(buttons(buildDrawer({ ...base, setup: { kind: 'creating' } }).blocks)).toEqual([]);
    const started = buildDrawer({
      ...base,
      setup: { kind: 'started', setupTaskId: 's1' },
      setupTaskName: 'port-setup',
    });
    expect(texts(started.blocks)).toContain('Setup is running in task port-setup.');
    expect(buttons(started.blocks)).toEqual(['open-setup', 'dismiss']);
    expect(
      buttons(buildDrawer({ ...base, setup: { kind: 'create-failed', message: 'x' } }).blocks),
    ).toEqual(['start', 'dismiss']);
    expect(
      buttons(buildDrawer({ ...base, setup: { kind: 'allocated', count: 2 } }).blocks),
    ).toEqual(['restart', 'dismiss']);
    const waiting = buildDrawer({
      ...base,
      setup: { kind: 'waiting', since: 0, errors: ['ports[0].label missing'] },
    });
    expect(waiting.blocks[0]).toMatchObject({ type: 'progress' });
    expect(texts(waiting.blocks)).toContain('ports[0].label missing');
  });

  it('configured: lists ports with status, summary and actions', () => {
    const d = buildDrawer({
      ...base,
      configured: true,
      ports: [
        port({ label: 'api', hostPort: 4100, runCommand: 'pnpm api', logsCommand: 'tail api' }),
        port({ label: 'web', hostPort: 3100, runCommand: 'pnpm dev' }),
      ],
      liveness: { 4100: 'up', 3100: 'down' },
      owned: new Set(),
    });
    expect(d.summary).toBe('1/2 up');
    expect(d.actions!.map((a) => a.id)).toEqual(['run-all', 'stop-all', 'refresh']);
    const rows = d.blocks[0]!.type === 'list' ? d.blocks[0]!.rows : [];
    expect(rows.map((r) => [r.label, r.meta, r.status])).toEqual([
      ['api', ':4100', 'up'],
      ['web', ':3100', 'down'],
    ]);
    expect(rows[0]!.actions!.map((a) => a.id)).toEqual(['stop:api', 'logs:api', 'open:api']);
    expect(rows[1]!.actions!.map((a) => a.id)).toEqual(['run:web', 'open:web']);
    expect(rows[1]!.onClick).toBe('open:web');
    expect(rows[1]!.tooltip).toBe(
      'web · Auto-allocated (deterministic hash) · $WEB_PORT · not listening',
    );
  });

  it('an owned service counts as running before its port answers', () => {
    const d = buildDrawer({
      ...base,
      configured: true,
      ports: [port({ runCommand: 'pnpm dev' })],
      liveness: { 3100: 'unknown' },
      owned: new Set(['web']),
    });
    const r = d.blocks[0]!.type === 'list' ? d.blocks[0]!.rows[0]! : null;
    expect(r!.status).toBe('up');
    expect(r!.actions!.map((a) => a.id)).toEqual(['stop:web', 'logs:web', 'open:web']);
    expect(d.actions!.map((a) => a.id)).toEqual(['stop-all', 'refresh']);
  });

  it('configured with no ports declared says so', () => {
    const d = buildDrawer({ ...base, configured: true });
    expect(texts(d.blocks)).toEqual(['.dash/ports.json declares no ports.']);
  });
});
