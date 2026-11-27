import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import {
  FOOTPRINT_PERL,
  footprintOrRss,
  parseFootprints,
  parsePs,
  rssBytes,
  subtreeBytes,
  subtreePids,
  type ProcRow,
} from '../processTree';

describe('parsePs', () => {
  it('reads pid, ppid and rss, skipping lines that are not three integers', () => {
    const out = [
      '    1     0  1200',
      '  42     1 3000',
      '',
      'garbage line',
      '  7  1  x',
      ' 0 0 5',
    ].join('\n');
    expect(parsePs(out)).toEqual([
      { pid: 1, ppid: 0, rssKb: 1200 },
      { pid: 42, ppid: 1, rssKb: 3000 },
    ]);
  });
});

// 1 (launchd)
// ├─ 100 Dash main ─┬─ 101 renderer ── 110 pty shell ── 111 dev server
// │                 └─ 102 GPU
// └─ 200 claude (task a) ─┬─ 201 MCP server
//                         └─ 202 shell ── 203 subagent tool
//    300 claude (task b), no children
const rows: ProcRow[] = [
  { pid: 1, ppid: 0, rssKb: 10 },
  { pid: 100, ppid: 1, rssKb: 100 },
  { pid: 101, ppid: 100, rssKb: 50 },
  { pid: 102, ppid: 100, rssKb: 20 },
  { pid: 110, ppid: 101, rssKb: 5 },
  { pid: 111, ppid: 110, rssKb: 7 },
  { pid: 200, ppid: 1, rssKb: 400 },
  { pid: 201, ppid: 200, rssKb: 30 },
  { pid: 202, ppid: 200, rssKb: 3 },
  { pid: 203, ppid: 202, rssKb: 9 },
  { pid: 300, ppid: 1, rssKb: 250 },
];
const KB = 1024;

const rss = rssBytes(rows);

describe('parseFootprints', () => {
  it('reads pid and bytes, skipping anything else', () => {
    const out = ['42 470369336', '7 6619136', '', 'Argument "x" isn\'t numeric', '9 x'].join('\n');
    expect(parseFootprints(out)).toEqual(
      new Map([
        [42, 470369336],
        [7, 6619136],
      ]),
    );
  });
});

describe('FOOTPRINT_PERL', () => {
  it.runIf(process.platform === 'darwin')('reads this process and skips a pid that is gone', () => {
    const out = execFileSync('perl', ['-e', FOOTPRINT_PERL, String(process.pid), '999999']);
    const got = parseFootprints(String(out));
    expect([...got.keys()]).toEqual([process.pid]);
    // A live Node process holds at least a few MB and nowhere near its virtual size.
    expect(got.get(process.pid)).toBeGreaterThan(4 * 1024 * 1024);
    expect(got.get(process.pid)).toBeLessThan(process.memoryUsage().rss * 4);
  });
});

describe('footprintOrRss', () => {
  it('takes the footprint where it was read and RSS for the rest', () => {
    const got = footprintOrRss(rows, new Map([[200, 123]]));
    expect(got.get(200)).toBe(123);
    expect(got.get(201)).toBe(30 * KB);
  });
});

describe('subtreePids', () => {
  it('collects the roots and every descendant once', () => {
    expect([...subtreePids(rows, [200, 202, 300])].sort((a, b) => a - b)).toEqual([
      200, 201, 202, 203, 300,
    ]);
  });

  it('keeps a root missing from the listing', () => {
    expect([...subtreePids(rows, [999])]).toEqual([999]);
  });
});

describe('subtreeBytes', () => {
  it('sums each root with every descendant, in bytes', () => {
    const got = subtreeBytes(
      rows,
      [
        { key: 'a', pid: 200 },
        { key: 'b', pid: 300 },
        { key: 'dash', pid: 100 },
      ],
      rss,
    );
    expect(got.get('a')).toBe((400 + 30 + 3 + 9) * KB);
    expect(got.get('b')).toBe(250 * KB);
    expect(got.get('dash')).toBe((100 + 50 + 20 + 5 + 7) * KB);
  });

  it('counts a process once: an earlier, narrower root keeps its subtree', () => {
    // A task session that happens to live under Dash's main process.
    const got = subtreeBytes(
      rows,
      [
        { key: 'shell', pid: 110 },
        { key: 'dash', pid: 100 },
      ],
      rss,
    );
    expect(got.get('shell')).toBe((5 + 7) * KB);
    expect(got.get('dash')).toBe((100 + 50 + 20) * KB);
  });

  it('counts each process at the given bytes, 0 where it has none', () => {
    const got = subtreeBytes(
      rows,
      [{ key: 'a', pid: 200 }],
      new Map([
        [201, 5],
        [203, 7],
      ]),
    );
    expect(got.get('a')).toBe(12);
  });

  it('gives 0 to a root that has exited', () => {
    expect(subtreeBytes(rows, [{ key: 'gone', pid: 999 }], rss).get('gone')).toBe(0);
  });

  it('counts a root missing from the listing at its own bytes (Windows: no ps)', () => {
    const got = subtreeBytes(
      [],
      [
        { key: 'dash', pid: 10 },
        { key: 'dash', pid: 11 },
        { key: 'dash', pid: 10 },
      ],
      new Map([
        [10, 100],
        [11, 50],
      ]),
    );
    expect(got.get('dash')).toBe(150);
  });

  it('adds roots that share a key (a task with more than one process)', () => {
    const got = subtreeBytes(
      rows,
      [
        { key: 'a', pid: 201 },
        { key: 'a', pid: 300 },
      ],
      rss,
    );
    expect(got.get('a')).toBe((30 + 250) * KB);
  });

  it('survives a cycle and a self-parented row', () => {
    const odd: ProcRow[] = [
      { pid: 5, ppid: 6, rssKb: 1 },
      { pid: 6, ppid: 5, rssKb: 2 },
      { pid: 7, ppid: 7, rssKb: 4 },
    ];
    expect(subtreeBytes(odd, [{ key: 'x', pid: 5 }], rssBytes(odd)).get('x')).toBe(3 * KB);
    expect(subtreeBytes(odd, [{ key: 'y', pid: 7 }], rssBytes(odd)).get('y')).toBe(4 * KB);
  });
});
