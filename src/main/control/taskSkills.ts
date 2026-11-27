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
description: How to reach Dash from a Dash task with the dashctl command — tasks, services, showing the person a file (lines of code to explain something, or a plan or report rendered), and above all PR review (reading the PR and its threads, notes vs comments, line drafts, replies, the review summary). Use before running dashctl, whenever asked to review a PR or leave review notes or comments in Dash, and when you want to show the person some code, a plan or a report.
---

${MARKER}

# Using Dash from a task

You run inside a Dash task: a Claude Code session in its own checkout (often a git worktree), which the person watches in Dash. \`dashctl\` reaches Dash itself; it is on your \`PATH\`.${fallback} You see your own task and the tasks you created, in this project only.

Run \`dashctl help\` for every command, and \`dashctl <namespace> <verb> --help\` for one command's flags. Results are JSON; a refusal goes to stderr with a non-zero exit. A command about your own task needs no \`--task-id\`.

## Tasks and services

- \`dashctl tasks list\` / \`get\` / \`output\` / \`wait\` read tasks, and \`dashctl tasks watch\`, run in the background, prints a JSON line each time a task changes; \`dashctl tasks create <name> --project <project>\` starts one (its own worktree by default). Give its prompt as \`--prompt -\` and the text on stdin; without \`--prompt\`, the task starts with no prompt. \`--issue <number|url>\` or \`--work-item <id>\` links a GitHub issue or Azure DevOps work item and puts it in the task's context; \`dashctl tasks link <task-id>\` does it for an existing task. Message a task you created with \`dashctl tasks message <task-id>\` and the text on stdin (it starts a stopped session); read its answer with \`dashctl tasks reply <task-id> --message-id <id>\`, the id the message returned. Don't send a message twice: each one is a turn the task takes. A message headed \`[Message from … via Dash …]\` that reaches you is answered by your last message of that turn.
- How a task you created launches: \`dashctl tasks create\` takes \`--effort low|medium|high|xhigh|max|ultracode\`, \`--agent <name>\` (one of the project's custom agents, fixed for the task), \`--add-dir <folder>\` (repeat for more; Claude Code must trust each) and \`--extra-args '<claude flags>'\` (one quoted line; flags Dash sets itself, like permissions and model, are refused). \`dashctl tasks configure <task-id>\` changes the effort, folders or extra arguments later and restarts the task's session, which resumes its conversation; \`dashctl tasks get\` shows them.
- \`dashctl services list\` / \`start <label>\` / \`stop <label>\` / \`output <label>\` run the services from \`.dash/ports.json\` in Dash terminal tabs, on the task's own ports.

\`--project\` is your own project, by name or id (\`dashctl tasks get\` gives your task's \`projectId\`); your checkout's path isn't the project's when it is a worktree.

\`\`\`sh
dashctl tasks create "Fix the flaky test" --project <project> --prompt - <<'EOF'
The login test fails one run in five on CI. Find out why and fix it.
EOF
dashctl tasks configure <task-id> --effort high --add-dir ../shared-lib --extra-args '--chrome'
\`\`\`

## Showing the person a file

\`dashctl show <path>\` opens a file in front of the person, in your task's editor. Use it to explain something in the code (point at the lines you mean instead of pasting them), or to hand over a plan, a report or a summary to read. It never asks permission.

- Code and any other text file open as an ordinary tab the person can edit. \`--lines 42\` or \`--lines 10-20\` scrolls to those lines and highlights them.
- Markdown and HTML open rendered. \`--source\` opens the source instead, as \`--lines\` does.
- Showing the same file again reuses its tab and reads it again, and the tab follows the file while you write it. Another file takes the previous one's tab, unless the person has kept it.
- The file must be in your checkout, your scratchpad or the project's memory folder; write anything else there first. HTML is shown without scripts, network or images from outside the file, so inline what it needs (\`data:\` images, a \`<style>\` block).

\`\`\`sh
dashctl show src/auth/session.ts --lines 40-58   # "this is where the expired session slips through"
dashctl show docs/plan.md                         # a plan for the person to review, rendered
\`\`\`

## Reviewing a PR

\`dashctl review …\` works on the PR the task is in review mode for (the person picked it from the sidebar's PR button), else the open PR from the task's branch. Pass \`--number <pr>\` for another one; with neither, the command says so. What you write lands in the task's review mode and diff editor. **Nothing you write reaches the PR**: the person reads it, edits it and posts it. You can't post, resolve threads or vote, and don't do it any other way (\`gh\`, \`az\`, scripts) unless the person explicitly asks and has seen the text.

### Read before you write

- \`dashctl review pr\`: title, description, branches, reviewers, checks and changed files. \`viewerIsAuthor\` is true on the person's own PR. Add \`--conversation\` for its general comments and review summaries.
- \`dashctl review threads\`: the unresolved review threads, each with its id, file, lines and comments (\`--state resolved\` or \`all\` for the rest).
- \`dashctl review drafts-list\` and \`summary-get\`: what the person and you have already drafted, so you don't repeat it.

### Note or comment

Every draft has a \`--kind\`:

- **note**: for whoever works on this task (the person, or you later). It is never posted. Use it for things to check, fix or keep in mind.
- **comment**: for the PR's author, posted when the person posts the review. A thread holds comments: one on lines starts a thread (the person sees it in review mode's Threads tab), and a reply to a thread is always a comment.

If the person hasn't said which they want, ask rather than guess.

### Someone else's PR

When \`viewerIsAuthor\` is false:


- **On lines**: \`dashctl review drafts-create --path <file> --start-line <n> [--end-line <n>] --kind comment\`, the body on stdin. \`--path\` is repo-relative, and the lines are in the PR's version of the file (its head commit, not the base).
- **As a reply to a thread**: \`dashctl review drafts-create --reply-to <thread-id> --kind comment\`. It sits on the thread's lines; give no \`--path\` or lines.
- **On the whole PR**: \`dashctl review summary-set\` writes the review's summary from stdin, the PR-level comment posted with the verdict. There is one per review; setting it replaces the current one, and \`--body ''\` clears it.

\`\`\`sh
dashctl review drafts-create --path src/auth.ts --start-line 40 --kind comment <<'EOF'
This can be null when the session expired; guard it before reading \`user.id\`.
EOF
\`\`\`

### The person's own PR

When \`viewerIsAuthor\` is true, work through the unresolved threads: fix the code first, then propose a reply to each thread you dealt with, saying what changed. The person posts each reply (Post reply, or Post & resolve). Don't write a summary here.

\`\`\`sh
dashctl review drafts-create --reply-to <thread-id> --kind comment <<'EOF'
Guarded in \`session.ts\`; the expired case now returns 401.
EOF
\`\`\`

### Changing drafts

- You can change (\`drafts-update <id>\`: \`--body -\` with the new body on stdin, \`--start-line\`, \`--end-line\` or \`--kind\`) or delete (\`drafts-delete <id>\`) any draft, the person's too. Keep the person's wording unless they ask you to change it.
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
