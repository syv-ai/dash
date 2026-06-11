import { describe, it, expect } from 'vitest';
import { clackBlock, clackExitBlock } from '../clackLines';

const GRAY = '\x1b[90m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

describe('clackBlock', () => {
  it('opens with a blank gray gutter bar', () => {
    const block = clackBlock('info', 'done');
    expect(block.startsWith(`\r\n${GRAY}│\x1b[0m\r\n`)).toBe(true);
  });

  it('renders a detail-less info block as a single └ end line', () => {
    const block = clackBlock('info', 'Process exited with code 0');
    expect(block).toContain('└  Process exited with code 0');
    expect(block).not.toContain('◇');
    expect(block).not.toContain(RED);
  });

  it('renders an error headline with a red ■', () => {
    const block = clackBlock('error', 'Shell failed to start');
    expect(block).toContain(`${RED}■`);
    expect(block).toContain('Shell failed to start');
  });

  it('renders a warn headline with a yellow ▲', () => {
    const block = clackBlock('warn', 'Could not start Claude CLI');
    expect(block).toContain(`${YELLOW}▲`);
  });

  it('chains details with │ and ends on └', () => {
    const block = clackBlock('error', 'backing process not running', 'first hint', 'second hint');
    const lines = block.split('\r\n');
    expect(lines.find((l) => l.includes('first hint'))).toContain('│  ');
    expect(lines.find((l) => l.includes('second hint'))).toContain('└  ');
  });

  it('terminates every line with \\r\\n', () => {
    const block = clackBlock('info', 'done', 'hint');
    expect(block.endsWith('\r\n')).toBe(true);
    expect(block).not.toMatch(/[^\r]\n/);
  });
});

describe('clackExitBlock', () => {
  it('renders a clean exit as a gray info end line', () => {
    const block = clackExitBlock(0);
    expect(block).toContain('└  Process exited with code 0');
    expect(block).not.toContain(RED);
  });

  it('renders a non-zero exit with a red ■', () => {
    const block = clackExitBlock(1);
    expect(block).toContain(`${RED}■`);
    expect(block).toContain('Process exited with code 1');
  });

  it('puts the hint on the └ end line', () => {
    const block = clackExitBlock(1, 'Press Run in the Ports panel to start it again.');
    const lines = block.split('\r\n');
    expect(lines.find((l) => l.includes('Press Run'))).toContain('└  ');
  });
});
