import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DASH_SKILL_DIR,
  FEEDBACK_SKILL_DIR,
  FEEDBACK_TEMPLATE,
  dashSkill,
  feedbackSkill,
  syncTaskSkills,
} from '../taskSkills';

let repo: string;
const skill = (dir = DASH_SKILL_DIR) => path.join(repo, dir, 'SKILL.md');
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const sync = (dashAccess: boolean, dashctl: string | null = null) =>
  syncTaskSkills(repo, { dashAccess, dashctl, dashVersion: '0.19.0' });

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-skill-'));
  git('init', '-q');
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('syncTaskSkills', () => {
  it('writes both skills with Dash access on, kept out of git status', async () => {
    await sync(true);
    expect(fs.readFileSync(skill(), 'utf8')).toBe(dashSkill(null));
    expect(fs.readFileSync(skill(FEEDBACK_SKILL_DIR), 'utf8')).toBe(feedbackSkill('0.19.0'));
    expect(git('status', '--porcelain')).toBe('');
    // Again: no exclude line is added twice.
    await sync(true);
    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    for (const line of ['/.claude/skills/dash/', '/.claude/skills/dash-feedback/']) {
      expect(exclude.split('\n').filter((l) => l === line)).toHaveLength(1);
    }
  });

  it('gives every task the feedback skill, Dash access or not', async () => {
    await sync(false);
    expect(fs.existsSync(skill())).toBe(false);
    expect(fs.readFileSync(skill(FEEDBACK_SKILL_DIR), 'utf8')).toBe(feedbackSkill('0.19.0'));
    expect(git('status', '--porcelain')).toBe('');
  });

  it('refreshes an older copy Dash wrote, and removes the dash skill when access is off', async () => {
    await sync(true);
    fs.writeFileSync(skill(), dashSkill(null).replace('Reviewing a PR', 'Old'));
    await sync(true);
    expect(fs.readFileSync(skill(), 'utf8')).toBe(dashSkill(null));
    await sync(false);
    expect(fs.existsSync(path.join(repo, DASH_SKILL_DIR))).toBe(false);
    expect(fs.existsSync(skill(FEEDBACK_SKILL_DIR))).toBe(true);
  });

  it("leaves the repo's own skills of the same names alone", async () => {
    for (const dir of [DASH_SKILL_DIR, FEEDBACK_SKILL_DIR]) {
      fs.mkdirSync(path.dirname(skill(dir)), { recursive: true });
      fs.writeFileSync(skill(dir), '# ours');
    }
    await sync(true);
    await sync(false);
    expect(fs.readFileSync(skill(), 'utf8')).toBe('# ours');
    expect(fs.readFileSync(skill(FEEDBACK_SKILL_DIR), 'utf8')).toBe('# ours');
  });

  it("names dashctl's own path, for a session whose PATH lacks it", async () => {
    await sync(true, '/data/control/bin/dashctl');
    expect(fs.readFileSync(skill(), 'utf8')).toContain(
      'run it by its path, in double quotes: `"/data/control/bin/dashctl"`',
    );
    expect(dashSkill(null)).not.toContain('it is at');
  });
});

describe('feedbackSkill', () => {
  it("files on Dash's own issue form, with the running Dash's version", () => {
    const text = feedbackSkill('0.19.0');
    expect(text).toContain(`issues/new?template=${FEEDBACK_TEMPLATE}&title=`);
    expect(text).toContain('Dash 0.19.0');
    expect(text).toContain('gh issue create -R syv-ai/dash --label agent-feedback');
  });

  it("asks for the form's own fields, and offers its kinds verbatim", () => {
    const form = fs.readFileSync(
      path.join(__dirname, '../../../../.github/ISSUE_TEMPLATE', FEEDBACK_TEMPLATE),
      'utf8',
    );
    const text = feedbackSkill('0.19.0');
    for (const id of ['kind', 'feedback', 'context']) {
      expect(form).toContain(`id: ${id}`);
      expect(text).toContain(`&${id}=<${id}>`);
    }
    const kinds = [...form.matchAll(/^ {8}- (.+)$/gm)].map((m) => m[1]!);
    expect(kinds).toHaveLength(4);
    for (const kind of kinds) expect(text).toContain(`\`${kind}\``);
    expect(form).toContain('labels: [agent-feedback]');
  });
});
