/** Where a slash command or skill comes from, as Claude Code finds it. */
export type SlashCommandSource = 'user' | 'project' | 'plugin';

/**
 * A slash command or skill a person can run in a project's sessions: a skill
 * (`.claude/skills/<name>/SKILL.md`), a command (`.claude/commands/<name>.md`)
 * or a plugin's (`/<plugin>:<name>`). `name` is what follows the `/`.
 */
export interface SlashCommand {
  name: string;
  description: string;
  /** The frontmatter's `argument-hint`, e.g. `[issue-number]`. */
  argumentHint?: string;
  source: SlashCommandSource;
}
