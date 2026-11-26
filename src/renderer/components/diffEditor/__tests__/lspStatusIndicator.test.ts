import { describe, expect, it } from 'vitest';
import { LSP_DOT } from '../LspStatusIndicator';

// H4: a language server isn't an agent, so it draws no agent colour; only
// a failure is red (state-fail).
describe('LSP_DOT', () => {
  it('shows a stopped or missing server as neutral, not green', () => {
    expect(LSP_DOT.stopped).toEqual({ tone: 'neutral', pulse: false });
    expect(LSP_DOT.unavailable).toEqual({ tone: 'neutral', pulse: false });
  });

  it('shows a failed server red', () => {
    expect(LSP_DOT.failed).toEqual({ tone: 'fail', pulse: false });
  });

  it('shows a server coming up as a breathing neutral dot, not amber', () => {
    expect(LSP_DOT.starting).toEqual({ tone: 'neutral', pulse: true });
    expect(LSP_DOT.restarting).toEqual({ tone: 'neutral', pulse: true });
  });
});
