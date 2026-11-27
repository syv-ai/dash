import { describe, expect, it } from 'vitest';
import { diffJobDirs, isJobStateEvent } from '../jobsWatcher';

describe('isJobStateEvent', () => {
  it("counts the job's state file", () => {
    expect(isJobStateEvent('state.json')).toBe(true);
  });

  it('counts an event the platform gave no filename for', () => {
    expect(isJobStateEvent(null)).toBe(true);
  });

  it.each([
    'state.json.tmp.02e8495f', // the atomic write's temp file, before its rename
    'timeline.jsonl',
    'recap.trigger',
    'adopt.json',
    'tmp',
  ])('ignores %s', (filename) => {
    expect(isJobStateEvent(filename)).toBe(false);
  });
});

describe('diffJobDirs', () => {
  it('names the job folders that appeared and went', () => {
    expect(diffJobDirs(['aaaa', 'bbbb'], ['bbbb', 'cccc'])).toEqual({
      added: ['cccc'],
      removed: ['aaaa'],
    });
  });

  it('is empty when the folders are the same', () => {
    expect(diffJobDirs(['aaaa', 'bbbb'], ['bbbb', 'aaaa'])).toEqual({ added: [], removed: [] });
  });
});
