import { describe, it, expect } from 'vitest';
import { shellQuote, shellSplit } from '../shellQuote';

const words = (input: string) => {
  const r = shellSplit(input);
  if (!r.ok) throw new Error(r.error);
  return r.words;
};
const error = (input: string) => {
  const r = shellSplit(input);
  return r.ok ? null : r.error;
};

describe('shellSplit', () => {
  it('splits on any run of whitespace and keeps no empty words', () => {
    expect(words('  --chrome\t--debug \n api  ')).toEqual(['--chrome', '--debug', 'api']);
    expect(words('')).toEqual([]);
    expect(words('   ')).toEqual([]);
  });

  it('keeps single-quoted text exactly, backslashes and $ included', () => {
    expect(words(`--append-system-prompt 'Say "hi" \\n and cost $5'`)).toEqual([
      '--append-system-prompt',
      'Say "hi" \\n and cost $5',
    ]);
  });

  it('unescapes only the POSIX set inside double quotes', () => {
    expect(words(String.raw`"a \"b\" \\ \$ \x"`)).toEqual([String.raw`a "b" \ $ \x`]);
  });

  it('escapes one character outside quotes, and joins lines on backslash-newline', () => {
    expect(words(String.raw`--add-dir /tmp/with\ space`)).toEqual(['--add-dir', '/tmp/with space']);
    expect(words('--chrome \\\n--verbose')).toEqual(['--chrome', '--verbose']);
  });

  it('glues adjacent quoted and bare parts into one word', () => {
    expect(words(`--flag=a'b c'"d"`)).toEqual(['--flag=ab cd']);
  });

  it('keeps an empty quoted word', () => {
    expect(words(`--tools ''`)).toEqual(['--tools', '']);
    expect(words(`--tools ""`)).toEqual(['--tools', '']);
  });

  it('leaves --flag=value and short flags to the caller', () => {
    expect(words('-n x --name=y -pc')).toEqual(['-n', 'x', '--name=y', '-pc']);
  });

  it('round-trips shellQuote', () => {
    for (const value of ["it's", 'a b', '$(rm -rf ~)', '`x`', '\\', '"', '']) {
      expect(words(shellQuote(value))).toEqual([value]);
    }
  });

  it('refuses unclosed quotes and a trailing backslash', () => {
    expect(error("--x 'open")).toMatch(/single quote/);
    expect(error('--x "open')).toMatch(/double quote/);
    expect(error('--x \\')).toMatch(/backslash/);
  });

  it('refuses what a shell would expand, unless quoted', () => {
    expect(error('--add-dir $HOME/x')).toMatch(/\$ isn't expanded/);
    expect(error('--x `whoami`')).toMatch(/` isn't expanded/);
    expect(error('--x "$HOME"')).toMatch(/\$ isn't expanded/);
    expect(error('--add-dir ~/code')).toMatch(/~ isn't expanded/);
    expect(words("--add-dir '~/code' a~b")).toEqual(['--add-dir', '~/code', 'a~b']);
    expect(words("'$HOME' \\$x")).toEqual(['$HOME', '$x']);
  });

  it('refuses unquoted shell operators', () => {
    for (const op of ['|', '&', ';', '<', '>', '(', ')']) {
      expect(error(`--chrome ${op} x`)).toMatch(/shell operator/);
      expect(words(`'${op}'`)).toEqual([op]);
    }
  });
});
