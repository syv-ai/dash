import { describe, it, expect } from 'vitest';
import type { ActivityInfo } from '@shared/types';
import {
  activeTaskIds,
  findOutdated,
  nextDeferredStep,
  parseLsofExecutable,
  parseSessionCliVersion,
  versionFromExecutablePath,
} from '../claudeUpdatePlan';

describe('findOutdated', () => {
  it('lists live sessions on an older Claude Code than the installed one', () => {
    const outdated = findOutdated('2.1.333 (Claude Code)', [
      { taskId: 'a', version: '2.1.332' },
      { taskId: 'b', version: '2.1.333' },
      { taskId: 'c', version: '2.0.900' },
    ]);
    expect(outdated).toEqual([
      { taskId: 'a', version: '2.1.332' },
      { taskId: 'c', version: '2.0.900' },
    ]);
  });

  it('never counts a session newer than the install, or one whose version is unknown', () => {
    expect(
      findOutdated('2.1.332', [
        { taskId: 'a', version: '2.1.333' },
        { taskId: 'b', version: null },
      ]),
    ).toEqual([]);
  });

  it('reports nothing while the installed version is unknown', () => {
    expect(findOutdated(null, [{ taskId: 'a', version: '2.1.1' }])).toEqual([]);
  });
});

describe('activeTaskIds', () => {
  it('counts working and waiting tasks; subagents keep a task working', () => {
    const activity: Record<string, ActivityInfo> = {
      work: { state: 'busy' },
      sub: { state: 'busy', tool: { toolName: 'Agent', label: '1 subagent running' } },
      ask: { state: 'waiting' },
      rest: { state: 'idle' },
      stoppedByUser: { state: 'idle', interrupted: true },
      asleep: { state: 'stopped' },
      broken: { state: 'error' },
    };
    expect(activeTaskIds(activity).sort()).toEqual(['ask', 'sub', 'work']);
  });
});

describe('nextDeferredStep', () => {
  it('waits while any task anywhere is active, even one that is up to date', () => {
    expect(nextDeferredStep({ outdated: ['a'], active: ['other'], restarted: new Set() })).toEqual({
      kind: 'wait',
      active: ['other'],
    });
  });

  it('restarts every outdated session once everything is inactive', () => {
    expect(nextDeferredStep({ outdated: ['a', 'b'], active: [], restarted: new Set() })).toEqual({
      kind: 'restart',
      taskIds: ['a', 'b'],
    });
  });

  it('skips sessions already restarted in this request, and finishes when none are left', () => {
    expect(
      nextDeferredStep({ outdated: ['a', 'b'], active: [], restarted: new Set(['a']) }),
    ).toEqual({ kind: 'restart', taskIds: ['b'] });
    expect(nextDeferredStep({ outdated: ['a'], active: ['x'], restarted: new Set(['a']) })).toEqual(
      { kind: 'finished' },
    );
  });

  it('finishes when nothing is outdated any more (restarted elsewhere)', () => {
    expect(nextDeferredStep({ outdated: [], active: ['x'], restarted: new Set() })).toEqual({
      kind: 'finished',
    });
  });
});

describe('parseSessionCliVersion', () => {
  it("reads the job's cliVersion", () => {
    expect(parseSessionCliVersion('{"state":"working","cliVersion":"2.1.331"}')).toBe('2.1.331');
  });

  it('is null for a missing, malformed or non-version field', () => {
    expect(parseSessionCliVersion('{"state":"working"}')).toBeNull();
    expect(parseSessionCliVersion('not json')).toBeNull();
    expect(parseSessionCliVersion('{"cliVersion":"latest"}')).toBeNull();
    expect(parseSessionCliVersion('[]')).toBeNull();
  });
});

describe('versionFromExecutablePath', () => {
  it("reads the version from the native installer's versions/<v> file", () => {
    expect(versionFromExecutablePath('/Users/me/.local/share/claude/versions/2.1.331')).toBe(
      '2.1.331',
    );
    expect(versionFromExecutablePath('C:\\Users\\me\\claude\\versions\\2.1.331')).toBe('2.1.331');
  });

  it('is null for any other executable (an npm install runs node)', () => {
    expect(versionFromExecutablePath('/opt/homebrew/bin/node')).toBeNull();
    expect(versionFromExecutablePath('/x/versions/2.1.331/claude')).toBeNull();
  });
});

describe('parseLsofExecutable', () => {
  it("takes the process's first txt entry, its executable", () => {
    const out = [
      'p58909',
      'ftxt',
      'n/Users/me/.local/share/claude/versions/2.1.332',
      'ftxt',
      'n/Library/Preferences/Logging/.plist-cache.x',
    ].join('\n');
    expect(parseLsofExecutable(out)).toBe('/Users/me/.local/share/claude/versions/2.1.332');
  });

  it('is null when lsof printed no file', () => {
    expect(parseLsofExecutable('')).toBeNull();
  });
});
