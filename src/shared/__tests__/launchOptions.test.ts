import { describe, it, expect } from 'vitest';
import { launchOptionsProblem } from '../launchOptions';

describe('launchOptionsProblem', () => {
  it('passes what a dispatch would pass, and what is left out', () => {
    expect(launchOptionsProblem({})).toBeNull();
    expect(launchOptionsProblem({ extraArgs: '--chrome', addDirs: ['/lib', ''] })).toBeNull();
    expect(launchOptionsProblem({ extraArgs: null, addDirs: null })).toBeNull();
  });

  it('names the blocked flag or the folder, under its field', () => {
    expect(launchOptionsProblem({ extraArgs: '--model opus' })).toBe(
      "Extra arguments: --model is set by the task's Model picker; use that instead.",
    );
    expect(launchOptionsProblem({ addDirs: ['lib'] })).toBe(
      "Folders: lib isn't a full path; ~ and relative paths aren't expanded.",
    );
  });
});
