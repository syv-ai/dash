import type { SlashCommand } from '../../../shared/slashCommands';

/*
 * The `/` menu of the New task dialog's context prompt, as data. Claude Code
 * runs a slash command only from the start of a message (several may stack
 * there: `/write-tests /fix-issue 123`), and the context prompt opens the
 * task's first message, so the menu opens only for a `/` in that leading run.
 */

/** The `/name` being typed at `caret`: where its `/` is and what follows it. */
export interface SlashQuery {
  start: number;
  query: string;
}

/**
 * The slash command the caret is in, or null: a `/` that opens the text, or
 * follows only other `/commands` there, then name characters (letters,
 * digits, `-`, `_`, `.`, `:`) up to the caret.
 */
export function slashCommandAt(text: string, caret: number): SlashQuery | null {
  const m = /^\s*(?:\/[\w.:-]+\s+)*\/([\w.:-]*)$/u.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[1]!.length - 1, query: m[1]! };
}

/** The commands whose name starts with `query`, then those whose name has it
 *  elsewhere (a plugin's `/tools:deploy` for `dep`); case-insensitive, at most `limit`. */
export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
  limit = 8,
): SlashCommand[] {
  const q = query.toLowerCase();
  const name = (c: SlashCommand) => c.name.toLowerCase();
  const starts = commands.filter((c) => name(c).startsWith(q));
  const contains = commands.filter((c) => !name(c).startsWith(q) && name(c).includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** `text` with the command at `at` (typed up to `caret`) replaced by
 *  `/name ` and the caret after it. */
export function insertSlashCommand(
  text: string,
  at: SlashQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `/${name} `;
  // The rest of a name being replaced goes, and a space already there isn't doubled.
  const rest = text
    .slice(caret)
    .replace(/^[\w.:-]*/u, '')
    .replace(/^ /, '');
  return { text: text.slice(0, at.start) + inserted + rest, caret: at.start + inserted.length };
}
