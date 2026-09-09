import { describe, expect, it } from 'vitest';
import { isHostTerminalEnvKey, stripHostTerminalEnv } from '../hostTerminalEnv';

describe('isHostTerminalEnvKey', () => {
  it('matches host-terminal namespaces', () => {
    for (const key of [
      'WARP_TERMINAL_SESSION_UUID',
      'WARP_IS_LOCAL_SHELL_SESSION',
      'WARP_FOCUS_URL',
      'ITERM_SESSION_ID',
      'KITTY_WINDOW_ID',
      'GHOSTTY_RESOURCES_DIR',
      'WEZTERM_PANE',
      'ALACRITTY_WINDOW_ID',
    ]) {
      expect(isHostTerminalEnvKey(key), key).toBe(true);
    }
  });

  it('matches prefixless identity keys', () => {
    for (const key of [
      'TERM_PROGRAM',
      'TERM_PROGRAM_VERSION',
      'TERM_SESSION_ID',
      'LC_TERMINAL',
      'LC_TERMINAL_VERSION',
    ]) {
      expect(isHostTerminalEnvKey(key), key).toBe(true);
    }
  });

  it('leaves capability and unrelated vars alone', () => {
    for (const key of [
      'TERM',
      'COLORTERM',
      'PATH',
      'HOME',
      'SHELL',
      // Prefix boundary: only the `WARP_` namespace, not any name starting "WARP".
      'WARPSPEED',
      // VS Code entries are paired with GIT_ASKPASS; splitting them hangs git.
      'VSCODE_GIT_ASKPASS_NODE',
      'GIT_ASKPASS',
    ]) {
      expect(isHostTerminalEnvKey(key), key).toBe(false);
    }
  });
});

describe('stripHostTerminalEnv', () => {
  const warpEnv = {
    PATH: '/usr/bin',
    HOME: '/Users/dev',
    TERM: 'xterm-256color',
    TERM_PROGRAM: 'WarpTerminal',
    TERM_PROGRAM_VERSION: 'v0.2026.09.02.08.27.stable_01',
    WARP_IS_LOCAL_SHELL_SESSION: '1',
    WARP_TERMINAL_SESSION_UUID: 'f4173509e7ba4a628009dbf0b7bccdeb',
    WARP_FOCUS_URL: 'warp://session/f4173509e7ba4a628009dbf0b7bccdeb',
  };

  it('drops the launching terminal identity and keeps everything else', () => {
    expect(stripHostTerminalEnv(warpEnv)).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/dev',
      TERM: 'xterm-256color',
    });
  });

  it('does not mutate its input', () => {
    const input = { ...warpEnv };
    stripHostTerminalEnv(input);
    expect(input).toEqual(warpEnv);
  });

  it('preserves undefined-valued entries that are not host identity', () => {
    const out = stripHostTerminalEnv({ FOO: undefined, WARP_FOCUS_URL: 'warp://x' });
    expect(Object.keys(out)).toEqual(['FOO']);
  });
});
