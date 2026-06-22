import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getSkillDetail } from '../extensionsDetail';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-ed-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('getSkillDetail', () => {
  it('parses frontmatter + raw + bundled files from a skill folder', () => {
    const scope = tmp();
    const dir = path.join(scope, '.claude', 'skills', 'deploy');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    const raw = '---\nname: deploy\ndescription: Ship it.\nallowed-tools: Bash\n---\n# Deploy\n';
    fs.writeFileSync(path.join(dir, 'SKILL.md'), raw);
    fs.writeFileSync(path.join(dir, 'reference.md'), '# ref');
    fs.writeFileSync(path.join(dir, 'scripts', 'run.sh'), 'echo hi');
    expect(getSkillDetail(scope, 'deploy')).toEqual({
      name: 'deploy',
      description: 'Ship it.',
      allowedTools: ['Bash'],
      raw,
      files: ['reference.md', 'scripts/run.sh'],
    });
  });
  it('returns an empty files list when the folder holds only SKILL.md', () => {
    const scope = tmp();
    const dir = path.join(scope, '.claude', 'skills', 'solo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Solo\n');
    expect(getSkillDetail(scope, 'solo').files).toEqual([]);
  });
  it('returns {} when the SKILL.md is missing', () => {
    expect(getSkillDetail(tmp(), 'ghost')).toEqual({});
  });
  it('refuses path traversal in skillName — never reads outside the skills dir', () => {
    const scope = tmp();
    fs.mkdirSync(path.join(scope, '.claude', 'skills'), { recursive: true });
    // A SKILL.md one level above the skills dir — reachable via `..` without the guard.
    fs.writeFileSync(path.join(scope, '.claude', 'SKILL.md'), '# secret\n');
    expect(getSkillDetail(scope, '..')).toEqual({});
    expect(getSkillDetail(scope, '../../../../etc/passwd')).toEqual({});
  });
});
