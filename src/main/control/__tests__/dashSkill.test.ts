import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DASH_SKILL, DASH_SKILL_DIR, syncDashSkill } from '../dashSkill';

let repo: string;
const skill = () => path.join(repo, DASH_SKILL_DIR, 'SKILL.md');
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-skill-'));
  git('init', '-q');
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('syncDashSkill', () => {
  it('writes the skill with Dash access on, kept out of git status', async () => {
    await syncDashSkill(repo, true);
    expect(fs.readFileSync(skill(), 'utf8')).toBe(DASH_SKILL);
    expect(git('status', '--porcelain')).toBe('');
    // Again: the exclude line isn't added twice.
    await syncDashSkill(repo, true);
    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter((l) => l === '/.claude/skills/dash/')).toHaveLength(1);
  });

  it('refreshes an older copy Dash wrote, and removes it when access is off', async () => {
    await syncDashSkill(repo, true);
    fs.writeFileSync(skill(), DASH_SKILL.replace('Reviewing a PR', 'Old'));
    await syncDashSkill(repo, true);
    expect(fs.readFileSync(skill(), 'utf8')).toBe(DASH_SKILL);
    await syncDashSkill(repo, false);
    expect(fs.existsSync(path.join(repo, DASH_SKILL_DIR))).toBe(false);
  });

  it("leaves the repo's own dash skill alone", async () => {
    fs.mkdirSync(path.dirname(skill()), { recursive: true });
    fs.writeFileSync(skill(), '# ours');
    await syncDashSkill(repo, true);
    expect(fs.readFileSync(skill(), 'utf8')).toBe('# ours');
    await syncDashSkill(repo, false);
    expect(fs.readFileSync(skill(), 'utf8')).toBe('# ours');
  });

  it('does nothing with access off and no skill', async () => {
    await syncDashSkill(repo, false);
    expect(fs.existsSync(path.join(repo, '.claude'))).toBe(false);
  });
});
