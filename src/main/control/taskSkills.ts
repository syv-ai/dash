import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const exec = promisify(execFile);

/*
 * The skills Dash writes into a task's checkout, where Claude Code finds
 * project skills: `dash` (how to use dashctl) while the task has Dash access,
 * and `dash-feedback` (how to tell the Dash team something) always. Each is
 * kept out of git through the checkout's local excludes, never the repo's
 * .gitignore, and rewritten at every session start.
 */

/** Where each skill goes in a task's checkout. */
export const DASH_SKILL_DIR = path.join('.claude', 'skills', 'dash');
export const FEEDBACK_SKILL_DIR = path.join('.claude', 'skills', 'dash-feedback');

/** How every file Dash wrote begins its marker, so Dash only ever rewrites or
 *  removes its own: a skill the repo has by the same name is left alone. */
const OWNED = '<!-- Written by Dash';
const MARKER = `${OWNED}: rewritten each time the session starts, removed when Dash access is turned off. -->`;
const FEEDBACK_MARKER = `${OWNED}: rewritten each time the session starts. -->`;

/**
 * How to use `dashctl` from a task: the overview `dashctl` itself doesn't
 * give, above all the review workflow. `dashctl` is its absolute path, for a
 * session whose PATH lacks it.
 */
export function dashSkill(dashctl: string | null): string {
  const fallback = dashctl
    ? ` If the shell can't find it, run it by its path, in double quotes: \`"${dashctl}"\`.`
    : '';
  return `---
name: dash
description: How to reach Dash from a Dash task with the dashctl command — tasks, services, and above all PR review drafts (notes vs comments, line drafts, replies, the review summary). Use before running dashctl, and whenever asked to review a PR or leave review notes or comments in Dash.
---

${MARKER}

# Using Dash from a task

You run inside a Dash task: a Claude Code session in its own checkout (often a git worktree), which the person watches in Dash. \`dashctl\` reaches Dash itself; it is on your \`PATH\`.${fallback} You see your own task and the tasks you created, in this project only.

Run \`dashctl help\` for every command, and \`dashctl <namespace> <verb> --help\` for one command's flags. Results are JSON; a refusal goes to stderr with a non-zero exit. A command about your own task needs no \`--task-id\`.

## Tasks and services

- \`dashctl tasks list\` / \`get\` / \`output\` / \`wait\` read tasks; \`dashctl tasks create <name> --project <project>\` starts one (its own worktree by default). Give its prompt as \`--prompt -\` and the text on stdin; without \`--prompt\`, the task starts with no prompt. Message a task with \`SendMessage\` to its \`messageAddress\`, after \`dashctl tasks wake <task-id>\`.
- \`dashctl services list\` / \`start <label>\` / \`stop <label>\` / \`output <label>\` run the services from \`.dash/ports.json\` in Dash terminal tabs, on the task's own ports.

\`--project\` is your own project, by name or id (\`dashctl tasks get\` gives your task's \`projectId\`); your checkout's path isn't the project's when it is a worktree.

\`\`\`sh
dashctl tasks create "Fix the flaky test" --project <project> --prompt - <<'EOF'
The login test fails one run in five on CI. Find out why and fix it.
EOF
\`\`\`

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
- **On the whole PR**: not a line draft. \`dashctl review summary-set --number <pr>\` writes the review's summary from stdin, the PR-level comment posted with the verdict. There is one per review; setting it replaces the current one, and \`--body ''\` clears it.

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

/** The issue form a feedback link fills in (`.github/ISSUE_TEMPLATE/`). */
export const FEEDBACK_TEMPLATE = 'agent-feedback.yml';

/**
 * How to tell the Dash team something: what the agent wishes Dash had, or
 * what its developer has to say about Dash, as a GitHub issue the person
 * submits. Claude Code's own feedback reaches Anthropic, not Dash.
 */
export function feedbackSkill(dashVersion: string): string {
  return `---
name: dash-feedback
description: Send feedback to the Dash team as a GitHub issue on syv-ai/dash, drafted by you and submitted by the user. Use when you wish Dash gave you something it doesn't (a dashctl command, a skill, an instruction), when something in Dash is broken or a Dash skill is unclear or wrong, when the user has something to say about Dash itself, or when asked how to reach the people who build Dash.
---

${FEEDBACK_MARKER}

# Feedback for the Dash team

You run in a Dash task: Dash is the app around this session (its worktree, its terminal, \`dashctl\`, the skills it writes into \`.claude/skills/\`). Dash is open source at https://github.com/syv-ai/dash, and its issues are where feedback goes. Claude Code's own feedback tools reach Anthropic, not the Dash team.

Two kinds are welcome:

- **Yours**: something you needed from Dash and didn't have, or that cost you a detour: a missing \`dashctl\` command or flag, an answer that left out what you needed, a skill or instruction that was unclear or wrong.
- **The user's**: anything they say about Dash itself (the app, its editor, task handling, the harness around you), not about their own project.

**The repository is public.** An issue is readable by anyone, so nothing from the user's project goes in it: no code, file or project names, paths, prompts or output that say more than the problem needs. Describe the situation in general terms.

## Draft it first

Write the issue and show it to the user before it goes anywhere:

- **Title:** one line naming the problem, not the fix.
- **Kind:** one of \`Something is missing\`, \`Something is broken\`, \`A skill or instruction is unclear or wrong\`, \`Other\`.
- **Feedback:** what you were doing, where it got stuck, and what would have made it easy.
- **Context:** the \`dashctl\` command, skill or Dash feature involved; Dash ${dashVersion}; and \`claude --version\`.

One issue per problem, so each can be closed on its own.

## Then one of two ways

**A link the user submits (the default).** It works for anyone with a GitHub account and needs nothing installed. Percent-encode each value:

\`\`\`
https://github.com/syv-ai/dash/issues/new?template=${FEEDBACK_TEMPLATE}&title=<title>&kind=<kind>&feedback=<feedback>&context=<context>
\`\`\`

Give the user the link. The form opens filled in, and they submit it.

**\`gh\`, when the user asks you to file it.** Only if \`gh auth status\` succeeds, and only after the user has approved the text:

\`\`\`sh
gh issue create -R syv-ai/dash --label agent-feedback --title '<title>' --body-file <draft.md>
\`\`\`

The issue is then posted under the user's GitHub account, so it is theirs to approve.
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

/** Keep a skill out of `git status` without touching the repo's .gitignore. */
async function excludeFromGit(cwd: string, dir: string): Promise<void> {
  const file = await excludeFile(cwd);
  if (!file) return;
  const line = `/${dir.split(path.sep).join('/')}/`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split('\n').some((l) => l.trim() === line)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${sep}# A skill Dash writes for its tasks\n${line}\n`);
}

/** Write `content` as the skill at `dir` (and keep it out of git), or with
 *  null remove it, either only when the file there is Dash's own. */
async function syncSkill(cwd: string, dir: string, content: string | null): Promise<void> {
  const file = path.join(cwd, dir, 'SKILL.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (existing !== null && !existing.includes(OWNED)) return;
  if (content !== null) {
    if (existing !== content) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    await excludeFromGit(cwd, dir);
  } else if (existing !== null) {
    fs.rmSync(path.join(cwd, dir), { recursive: true, force: true });
  }
}

/**
 * Bring a task's checkout's skills up to date at a session start: the dash
 * skill only with Dash access (removed when it's off), the feedback skill
 * always.
 */
export async function syncTaskSkills(
  cwd: string,
  opts: { dashAccess: boolean; dashctl: string | null; dashVersion: string },
): Promise<void> {
  await syncSkill(cwd, DASH_SKILL_DIR, opts.dashAccess ? dashSkill(opts.dashctl) : null);
  await syncSkill(cwd, FEEDBACK_SKILL_DIR, feedbackSkill(opts.dashVersion));
}
