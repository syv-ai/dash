import { describe, it, expect } from 'vitest';
import { createParser, type ParserEvent } from '../preCommitParser';

function feed(lines: string[]): ParserEvent[] {
  const p = createParser();
  const out: ParserEvent[] = [];
  for (const line of lines) for (const ev of p.feed(line)) out.push(ev);
  for (const ev of p.flush()) out.push(ev);
  return out;
}

describe('preCommitParser', () => {
  it('emits hookResult on a passed line', () => {
    const out = feed(['Trim trailing whitespace.............................Passed']);
    expect(out).toEqual([
      { type: 'hookResult', name: 'Trim trailing whitespace', status: 'Passed' },
    ]);
  });

  it('emits hookResult for failed and skipped', () => {
    const out = feed([
      'ruff.................................................Failed',
      'Check yaml...........................................Skipped',
    ]);
    expect(
      out
        .filter((e): e is Extract<ParserEvent, { type: 'hookResult' }> => e.type === 'hookResult')
        .map((e) => e.status),
    ).toEqual(['Failed', 'Skipped']);
  });

  it('folds metadata under the current hook', () => {
    const out = feed([
      'black................................................Failed',
      '- hook id: black',
      '- exit code: 1',
      '- files were modified by this hook',
    ]);
    expect(out).toEqual([
      { type: 'hookResult', name: 'black', status: 'Failed' },
      { type: 'hookMeta', key: 'id', value: 'black' },
      { type: 'hookMeta', key: 'exit', value: 1 },
      { type: 'hookMeta', key: 'modified', value: true },
    ]);
  });

  it('collects diagnostic body lines between result and next header', () => {
    const out = feed([
      'ruff.................................................Failed',
      '',
      'src/foo.py:1:1: F401 unused import',
      'src/bar.py:42:5: E711 comparison to None',
      'mypy.................................................Passed',
    ]);
    const diags = out
      .filter(
        (e): e is Extract<ParserEvent, { type: 'hookDiagnostic' }> => e.type === 'hookDiagnostic',
      )
      .map((e) => e.text);
    expect(diags).toEqual([
      '',
      'src/foo.py:1:1: F401 unused import',
      'src/bar.py:42:5: E711 comparison to None',
    ]);
  });

  it('emits rawOutput for lines before any hookResult', () => {
    const out = feed(['fatal: git config issue', 'some other unrelated output']);
    expect(out).toEqual([
      { type: 'rawOutput', text: 'fatal: git config issue' },
      { type: 'rawOutput', text: 'some other unrelated output' },
    ]);
  });

  it('handles a complete prek-style run end-to-end', () => {
    const out = feed([
      'Trim trailing whitespace.............................Passed',
      'Check yaml...........................................Skipped',
      'black................................................Failed',
      '- hook id: black',
      '- files were modified by this hook',
      '',
      'reformatted src/foo.py',
    ]);
    const results = out.filter((e) => e.type === 'hookResult');
    expect(results).toHaveLength(3);
    const meta = out.filter((e) => e.type === 'hookMeta');
    expect(meta).toHaveLength(2);
    const diag = out.filter((e) => e.type === 'hookDiagnostic');
    expect(diag.length).toBeGreaterThan(0);
  });
});
