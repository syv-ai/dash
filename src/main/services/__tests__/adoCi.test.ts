import { describe, it, expect } from 'vitest';
import timeline from './fixtures/ado-build-timeline.json';
import { adoBuildIdOf, adoLogExcerpt, adoLogStartLine, adoTimelineFailure } from '../adoCi';

describe('adoTimelineFailure', () => {
  it("names the failed tasks under their job, their errors, and the last one's log", () => {
    expect(adoTimelineFailure(timeline)).toEqual({
      failedSteps: ['Linux / Lint', 'Linux / npm test'],
      annotations: [
        'error src/a.test.ts:12: Expected 2 to be 3',
        "error Bash exited with code '1'.",
      ],
      logId: 5,
    });
  });

  it('tells nothing of a timeline it cannot read', () => {
    expect(adoTimelineFailure(null)).toEqual({ failedSteps: [], annotations: [], logId: null });
  });
});

describe('adoLogExcerpt', () => {
  it('drops the timestamps and stops at the last error', () => {
    const log = [
      '2026-11-27T10:00:00.1000000Z ##[section]Starting: npm test',
      '2026-11-27T10:00:01.2000000Z FAIL src/a.test.ts',
      '2026-11-27T10:00:01.3000000Z ##[error]Bash exited with code 1.',
      '2026-11-27T10:00:01.4000000Z ##[section]Finishing: npm test',
    ].join('\n');
    expect(adoLogExcerpt(log)).toBe(
      '##[section]Starting: npm test\nFAIL src/a.test.ts\n##[error]Bash exited with code 1.',
    );
  });
});

describe('adoLogStartLine', () => {
  it('reads the last lines of a long log, all of a short or unknown one', () => {
    const logs = {
      value: [
        { id: 5, lineCount: 1000 },
        { id: 6, lineCount: 10 },
      ],
    };
    expect(adoLogStartLine(logs, 5)).toBe(601);
    expect(adoLogStartLine(logs, 6)).toBe(1);
    expect(adoLogStartLine(null, 5)).toBe(1);
  });
});

describe('adoBuildIdOf', () => {
  it("reads a build policy's build from its link", () => {
    expect(adoBuildIdOf('https://dev.azure.com/o/P/_build/results?buildId=42')).toBe(42);
    expect(adoBuildIdOf('https://ci.example.com/run/1')).toBeNull();
    expect(adoBuildIdOf(null)).toBeNull();
  });
});
