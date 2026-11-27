/** Where a slash command, skill or agent comes from, as Claude Code finds it. */
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

/**
 * A custom subagent a session can run as (`claude --agent <name>`): a user or
 * project `.claude/agents/**\/*.md`, or an enabled plugin's `agents/`
 * (code.claude.com/docs/en/sub-agents). `name` is what `--agent` takes: the
 * frontmatter name, or for a plugin's its scoped `<plugin>:<folders>:<name>`.
 */
export interface AgentDefinition {
  name: string;
  description: string;
  source: SlashCommandSource;
}
