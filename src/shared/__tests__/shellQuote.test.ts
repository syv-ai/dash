import { describe, it, expect } from 'vitest';
import { shellQuote } from '../shellQuote';

describe('shellQuote', () => {
  it('quotes plain paths', () => {
    expect(shellQuote('/usr/local/bin/dashctl')).toBe("'/usr/local/bin/dashctl'");
  });

  it('quotes paths containing spaces', () => {
    expect(shellQuote('/Application Support/Dash/bin/dashctl')).toBe(
      "'/Application Support/Dash/bin/dashctl'",
    );
  });

  it('escapes embedded single quotes without leaving an injection hole', () => {
    // The output must be a single concatenated shell token — decoding it
    // should yield the exact input back.
    const input = "/tmp/weird'dir/dashctl";
    const quoted = shellQuote(input);
    expect(quoted).toBe("'/tmp/weird'\\''dir/dashctl'");
    // Sanity: the quoted form contains no unescaped bareword that could run.
    expect(quoted).not.toMatch(/[^\\]\$\(/);
    expect(quoted).not.toMatch(/[^\\]`/);
  });

  it('survives $, backtick, and backslash without expansion', () => {
    const input = '/tmp/$(rm -rf ~)/`whoami`/dashctl';
    const quoted = shellQuote(input);
    // With single quotes, none of these metachars get interpreted by sh.
    expect(quoted.startsWith("'") && quoted.endsWith("'")).toBe(true);
    expect(quoted).toContain('$(rm -rf ~)');
    expect(quoted).toContain('`whoami`');
  });
});
