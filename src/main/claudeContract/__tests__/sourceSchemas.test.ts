import { describe, expect, it } from 'vitest';
import { checkShape } from '../check';
import { statusLineSchema } from '../statusLineSchema';
import {
  checkAgentsJson,
  checkDispatchOutput,
  checkVersionOutput,
  exitCodeDrift,
} from '../cliSchemas';
import {
  checkInstalledPlugins,
  checkJobState,
  checkSessionEntry,
  checkTranscriptUsage,
} from '../internalSchemas';
import statusLineDocs from './fixtures/statusline-docs.json';
import agents from './fixtures/agents-2.1.332.json';

describe('statusLine', () => {
  it('matches the documented full payload', () => {
    expect(checkShape(statusLineSchema, statusLineDocs)).toEqual([]);
  });

  it('knows scratchpad_dir, which 2.1.332 sends though the docs leave it out', () => {
    expect(checkShape(statusLineSchema, { ...statusLineDocs, scratchpad_dir: '/s' })).toEqual([]);
  });

  it('allows the documented nulls early in a session', () => {
    const early = {
      ...statusLineDocs,
      context_window: {
        ...statusLineDocs.context_window,
        used_percentage: null,
        remaining_percentage: null,
        current_usage: null,
      },
    };
    expect(checkShape(statusLineSchema, early)).toEqual([]);
  });

  it('reports a new rate-limit window and a model given as a string', () => {
    const drifted = {
      ...statusLineDocs,
      model: 'opus',
      rate_limits: {
        ...statusLineDocs.rate_limits,
        one_hour: { used_percentage: 1, resets_at: 1 },
      },
    };
    expect(checkShape(statusLineSchema, drifted)).toEqual([
      { kind: 'wrong-type', path: 'model' },
      { kind: 'unexpected-field', path: 'rate_limits.one_hour' },
    ]);
  });
});

describe('claude agents --json', () => {
  it('matches the 2.1.332 listing', () => {
    expect(checkAgentsJson(JSON.stringify(agents.rows))).toEqual([]);
  });

  it('reports an unknown state, a new field and output that is not JSON', () => {
    const row = { ...agents.rows[0], state: 'paused', effort: 'high' };
    expect(checkAgentsJson(JSON.stringify([row]))).toEqual([
      { kind: 'unknown-enum-value', path: '[].state', value: 'paused' },
      { kind: 'unexpected-field', path: '[].effort' },
    ]);
    expect(checkAgentsJson('Error: no supervisor')).toEqual([
      { kind: 'unparseable-output', path: 'stdout' },
    ]);
  });
});

describe('CLI output and exit codes', () => {
  it('reads `claude --version`', () => {
    expect(checkVersionOutput('2.1.332 (Claude Code)\n')).toEqual([]);
    expect(checkVersionOutput('Claude Code v3')).toEqual([
      { kind: 'unparseable-output', path: 'stdout' },
    ]);
  });

  it("knows `claude --bg`'s job line and the refusals Dash acts on (2.1.332, live)", () => {
    for (const output of [
      'backgrounded · 2a684244 · agentflags-extra\n',
      "Couldn't start a background session: the supervisor is not running",
      'Workspace not trusted. Run `claude` in /p/proj once and accept the trust prompt, then retry.',
      'Added folder not trusted: /p/untrusted-dir. Leave out its --add-dir or, if you trust it and everything in its repository or below it, start `claude` there once and accept the trust prompt.',
    ]) {
      expect(checkDispatchOutput(output), output).toEqual([]);
    }
    expect(checkDispatchOutput('Error: something new')).toEqual([
      { kind: 'unparseable-output', path: 'stdout' },
    ]);
  });

  it('reports an exit status, not a timeout or a missing binary', () => {
    expect(exitCodeDrift({ code: 3 })).toEqual([
      { kind: 'unexpected-exit-code', path: 'exit', value: '3' },
    ]);
    expect(exitCodeDrift({ code: 'ENOENT' })).toEqual([]);
    expect(exitCodeDrift({ killed: true })).toEqual([]);
  });
});

describe('internal files (loose)', () => {
  it("doesn't report a job state without cliVersion (before the first turn)", () => {
    expect(checkJobState({ state: 'working' })).toEqual([]);
    expect(checkJobState({ cliVersion: '2.1.332', anything: 1 })).toEqual([]);
    expect(checkJobState({ cliVersion: 2 })).toEqual([{ kind: 'wrong-type', path: 'cliVersion' }]);
    expect(checkJobState({ cliVersion: 'next' })).toEqual([
      { kind: 'unparseable-output', path: 'cliVersion' },
    ]);
  });

  it('checks only the registry fields Dash reads', () => {
    expect(
      checkSessionEntry({ pid: 1, sessionId: 's', version: '2.1.332', peerFeatures: [] }),
    ).toEqual([]);
    expect(checkSessionEntry({ pid: '1' })).toEqual([{ kind: 'wrong-type', path: 'pid' }]);
  });

  it('reports a model claudePricing prices as Sonnet by default', () => {
    const usage = { input_tokens: 1, output_tokens: 1, service_tier: 'standard' };
    expect(checkTranscriptUsage(usage, 'claude-opus-5-5')).toEqual([]);
    expect(checkTranscriptUsage(usage, '<synthetic>')).toEqual([]);
    expect(checkTranscriptUsage(usage, 'claude-fable-5-2')).toEqual([
      { kind: 'unknown-enum-value', path: 'message.model', value: 'claude-fable-5-2' },
    ]);
    expect(checkTranscriptUsage({ input_tokens: '1', output_tokens: 1 }, undefined)).toEqual([
      { kind: 'wrong-type', path: 'message.usage.input_tokens' },
    ]);
  });
});

describe('installed_plugins.json', () => {
  it('passes a current file and reports a changed install entry', () => {
    const install = { scope: 'user', installPath: '/p/x/1.0.0', version: '1.0.0' };
    expect(checkInstalledPlugins({ version: 2, plugins: { 'x@m': [install] } })).toEqual([]);
    expect(checkInstalledPlugins({ version: 2, plugins: { 'x@m': [{ scope: 'user' }] } })).toEqual([
      { kind: 'missing-field', path: 'plugins.x@m[].installPath' },
    ]);
  });
});
