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

/** How to use the dash MCP tools: the overview no single tool description gives. */
export const DASH_SKILL = `---
name: dash
description: How to use the Dash MCP tools (mcp__dash__*) from a Dash task — tasks, services, and above all PR review drafts (notes vs comments, line drafts, replies, the review summary). Use before calling any dash tool, and whenever asked to review a PR or leave review notes or comments in Dash.
---

${MARKER}

# Using Dash from a task

You run inside a Dash task: a Claude Code session in its own checkout (often a git worktree), which the person watches in Dash. The \`dash\` MCP tools reach Dash itself. You see your own task and the tasks you created, in this project only.

## Tasks and services

- \`tasks_list\` / \`tasks_get\` / \`tasks_output\` / \`tasks_wait\` read tasks; \`tasks_create\` starts one with a prompt (its own worktree by default). Message a task with \`SendMessage\` to its \`messageAddress\`, after \`tasks_wake\`.
- \`services_list\` / \`services_start\` / \`services_stop\` / \`services_output\` run the services from \`.dash/ports.json\` in Dash terminal tabs, on the task's own ports.

## Reviewing a PR

The \`review_*\` tools write into the PR view of the task's diff editor (Compare → Pull requests). **Nothing you write reaches the PR**: the person reads everything, edits it, picks the verdict and submits. You can't submit, resolve threads or vote, and don't post to the PR any other way (\`gh\`, \`az\`, scripts) unless the person explicitly asks for that and has seen the text.

### Note or comment

Every draft has a \`kind\`:

- **comment**: review feedback for the PR's author, posted when the person submits. Write these when you're reviewing someone else's PR.
- **note**: for whoever works on this task (the person, or you later). It is never posted. Use it for things to check, fix or keep in mind that aren't feedback for the author, for example findings to act on in this branch. The person can promote a note to a comment.

If the person hasn't said which they want, ask rather than guess.

### Where a draft goes

- **On lines**: \`review_drafts_create\` with \`path\` (repo-relative) and \`startLine\`/\`endLine\` in the PR's version of the file (its head commit, not the base).
- **As a reply to an existing thread**: the same tool with \`replyTo\`, the thread's id from the provider.
- **On the whole PR**: not a line draft. \`review_summary_set\` writes the review's summary, the PR-level comment posted with the verdict. There is one per review; setting it replaces the current one, and an empty body clears it.

### Working with what's there

- Read \`review_drafts_list\` and \`review_summary_get\` before writing, so you don't repeat what exists.
- You can update (\`review_drafts_update\`, including its \`kind\`) or delete (\`review_drafts_delete\`) any draft, the person's too. Keep the person's wording unless they ask you to change it.
- Write in Markdown; it is rendered in the editor.
`;

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
  fs.appendFileSync(file, `${sep}# Dash's skill for its MCP tools\n${line}\n`);
}

/**
 * With Dash access on, write the dash skill into the task's checkout (and keep
 * it out of git); with it off, remove the skill if Dash wrote it. A file
 * without Dash's marker is the repo's own and is left alone.
 */
export async function syncDashSkill(cwd: string, dashAccess: boolean): Promise<void> {
  const file = path.join(cwd, DASH_SKILL_DIR, 'SKILL.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const ours = existing === null || existing.includes(MARKER);
  if (!ours) return;
  if (dashAccess) {
    if (existing !== DASH_SKILL) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, DASH_SKILL);
    }
    await excludeFromGit(cwd);
  } else if (existing !== null) {
    fs.rmSync(path.join(cwd, DASH_SKILL_DIR), { recursive: true, force: true });
  }
}
