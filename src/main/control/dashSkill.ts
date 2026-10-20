import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const exec = promisify(execFile);

/** Where the skill goes in a task's checkout; Claude Code finds project skills there. */
export const DASH_SKILL_DIR = path.join('.claude', 'skills', 'dash');

/** Marks a file Dash wrote, so Dash only ever rewrites or removes its own. */
const MARKER =
  '<!-- Written by Dash: rewritten each time the session starts, removed when Dash access is turned off. -->';

/**
 * How to use `dashctl` from a task: the overview `dashctl` itself doesn't
 * give, above all the review workflow. `dashctl` is its absolute path, for a
 * session whose PATH lacks it.
 */
export function dashSkill(dashctl: string | null): string {
  const fallback = dashctl
    ? ` If the shell can't find it, it is at \`${dashctl}\` (quote the path).`
    : '';
  return `---
name: dash
description: How to reach Dash from a Dash task with the dashctl command — tasks, services, and above all PR review drafts (notes vs comments, line drafts, replies, the review summary). Use before running dashctl, and whenever asked to review a PR or leave review notes or comments in Dash.
---

${MARKER}

# Using Dash from a task

You run inside a Dash task: a Claude Code session in its own checkout (often a git worktree), which the person watches in Dash. \`dashctl\` reaches Dash itself; it is on your \`PATH\`.${fallback} You see your own task and the tasks you created, in this project only.

Run \`dashctl\` bare for every command, and \`dashctl <namespace> <verb> --help\` for one command's flags. Results are JSON; a refusal goes to stderr with a non-zero exit. A command about your own task needs no \`--task-id\`.

## Tasks and services

- \`dashctl tasks list\` / \`get\` / \`output\` / \`wait\` read tasks; \`dashctl tasks create <name>\` starts one, with its prompt on stdin (its own worktree by default). Message a task with \`SendMessage\` to its \`messageAddress\`, after \`dashctl tasks wake <task-id>\`.
- \`dashctl services list\` / \`start <label>\` / \`stop <label>\` / \`output <label>\` run the services from \`.dash/ports.json\` in Dash terminal tabs, on the task's own ports.

## Reviewing a PR

\`dashctl review …\` writes into the PR view of the task's diff editor (Compare → Pull requests). **Nothing you write reaches the PR**: the person reads everything, edits it, picks the verdict and submits. You can't submit, resolve threads or vote, and don't post to the PR any other way (\`gh\`, \`az\`, scripts) unless the person explicitly asks for that and has seen the text.

### Note or comment

Every draft has a \`--kind\`:

- **comment**: review feedback for the PR's author, posted when the person submits. Write these when you're reviewing someone else's PR.
- **note**: for whoever works on this task (the person, or you later). It is never posted. Use it for things to check, fix or keep in mind that aren't feedback for the author, for example findings to act on in this branch. The person can promote a note to a comment.

If the person hasn't said which they want, ask rather than guess.

### Where a draft goes

- **On lines**: \`dashctl review drafts-create --number <pr> --path <file> --start-line <n> [--end-line <n>] --kind comment\`, the body on stdin. \`--path\` is repo-relative, and the lines are in the PR's version of the file (its head commit, not the base).
- **As a reply to an existing thread**: the same command with \`--reply-to\`, the thread's id from the provider.
- **On the whole PR**: not a line draft. \`dashctl review summary-set --number <pr>\` writes the review's summary from stdin, the PR-level comment posted with the verdict. There is one per review; setting it replaces the current one, and an empty body clears it.

\`\`\`sh
dashctl review drafts-create --number 12 --path src/auth.ts --start-line 40 --kind comment <<'EOF'
This can be null when the session expired; guard it before reading \`user.id\`.
EOF
\`\`\`

### Working with what's there

- Read \`dashctl review drafts-list --number <pr>\` and \`summary-get\` before writing, so you don't repeat what exists.
- You can change (\`drafts-update <id>\`, including its \`--kind\`) or delete (\`drafts-delete <id>\`) any draft, the person's too. Keep the person's wording unless they ask you to change it.
- Write in Markdown; it is rendered in the editor.
`;
}

/** The git path of a checkout's local excludes (shared by its worktrees). */
async function excludeFile(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd });
    const p = stdout.trim();
    return p ? path.resolve(cwd, p) : null;
  } catch {
    return null;
  }
}

/** Keep the skill out of `git status` without touching the repo's .gitignore. */
async function excludeFromGit(cwd: string): Promise<void> {
  const file = await excludeFile(cwd);
  if (!file) return;
  const line = `/${DASH_SKILL_DIR.split(path.sep).join('/')}/`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split('\n').some((l) => l.trim() === line)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${sep}# Dash's skill for dashctl\n${line}\n`);
}

/**
 * With Dash access on, write the dash skill into the task's checkout (and keep
 * it out of git); with it off, remove the skill if Dash wrote it. A file
 * without Dash's marker is the repo's own and is left alone.
 */
export async function syncDashSkill(
  cwd: string,
  dashAccess: boolean,
  dashctl: string | null = null,
): Promise<void> {
  const content = dashSkill(dashctl);
  const file = path.join(cwd, DASH_SKILL_DIR, 'SKILL.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const ours = existing === null || existing.includes(MARKER);
  if (!ours) return;
  if (dashAccess) {
    if (existing !== content) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    await excludeFromGit(cwd);
  } else if (existing !== null) {
    fs.rmSync(path.join(cwd, DASH_SKILL_DIR), { recursive: true, force: true });
  }
}
