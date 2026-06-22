/**
 * Clack-style message blocks for lines Dash writes into terminals itself,
 * matching the @clack/prompts look of the ports side-car TUI:
 *
 *   │
 *   ■  headline            (◇ info · ■ error · ▲ warn, tone-colored)
 *   │  detail line
 *   └  last detail line
 *
 * Pure string builders — every line ends in \r\n, ready for terminal.write().
 */
const GRAY = '\x1b[90m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

export type ClackTone = 'info' | 'error' | 'warn';

const TONE_SYMBOL: Record<ClackTone, string> = { info: '◇', error: '■', warn: '▲' };
const TONE_COLOR: Record<ClackTone, string> = { info: GRAY, error: RED, warn: YELLOW };

export function clackBlock(tone: ClackTone, headline: string, ...details: string[]): string {
  // A detail-less info block is itself the end of the chain.
  const symbol = tone === 'info' && details.length === 0 ? '└' : TONE_SYMBOL[tone];
  const lines = [`${GRAY}│${RESET}`, `${TONE_COLOR[tone]}${symbol}  ${headline}${RESET}`];
  details.forEach((detail, i) => {
    const bar = i === details.length - 1 ? '└' : '│';
    lines.push(`${GRAY}${bar}  ${detail}${RESET}`);
  });
  return `\r\n${lines.join('\r\n')}\r\n`;
}

export function clackExitBlock(exitCode: number, hint?: string): string {
  const tone: ClackTone = exitCode === 0 ? 'info' : 'error';
  const headline = `Process exited with code ${exitCode}`;
  return hint ? clackBlock(tone, headline, hint) : clackBlock(tone, headline);
}
