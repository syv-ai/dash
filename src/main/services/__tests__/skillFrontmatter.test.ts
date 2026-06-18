import { describe, it, expect } from 'vitest';
import { parseSkillFrontmatter } from '../skillFrontmatter';

describe('parseSkillFrontmatter', () => {
  it('returns {} when there is no frontmatter', () => {
    expect(parseSkillFrontmatter('# Just a heading\n')).toEqual({});
  });
  it('parses name + description', () => {
    const md = `---\nname: tdd\ndescription: Red-green-refactor loop.\n---\n# TDD\n`;
    expect(parseSkillFrontmatter(md)).toEqual({
      name: 'tdd',
      description: 'Red-green-refactor loop.',
    });
  });
  it('parses allowed-tools as an inline comma list', () => {
    const md = `---\nname: x\nallowed-tools: Read, Write, Bash\n---\n`;
    expect(parseSkillFrontmatter(md).allowedTools).toEqual(['Read', 'Write', 'Bash']);
  });
  it('parses allowed-tools as an inline bracket list', () => {
    const md = `---\nallowed-tools: [Read, Write]\n---\n`;
    expect(parseSkillFrontmatter(md).allowedTools).toEqual(['Read', 'Write']);
  });
  it('parses allowed-tools as a YAML block list and reads model', () => {
    const md = `---\nname: y\nmodel: claude-opus-4-8\nallowed-tools:\n  - Read\n  - Edit\n---\n`;
    expect(parseSkillFrontmatter(md)).toMatchObject({
      name: 'y',
      model: 'claude-opus-4-8',
      allowedTools: ['Read', 'Edit'],
    });
  });
  it('strips surrounding quotes from values', () => {
    const md = `---\nname: "quoted"\ndescription: 'single'\n---\n`;
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'quoted', description: 'single' });
  });
});
