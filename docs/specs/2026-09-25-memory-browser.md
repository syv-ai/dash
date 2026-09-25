# Memory Browser Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users browse Claude Code's auto-memory for a project (`<claude config dir>/projects/<encoded repo root>/memory/*.md` plus the `MEMORY.md` index) from inside Dash. The memories are read-only in Dash and can be handed off to an external editor.

**Architecture:** A main-process `MemoryService` works out the memory folder the same way Claude Code does:
- take the git main-checkout root, falling back to the project path;
- encode it with a corrected `encodeProjectPath`;
- place it under `claudeConfigDir()/projects`.

It then reads and parses the files. A `MemoryWatcher` watches only one project, and only while the modal is open. It pushes `memory:changed` to the renderer. The renderer shows a `MemoryModal` (list grouped by type, search, markdown preview in the existing sandboxed-iframe renderer). Links between memories are rewritten and routed back to React through `postMessage`.

**Tech Stack:** Electron main (Node `fs`, `fs.watch`, `child_process.execFile`), zod IPC validation, React 19 + zustand, `marked` (existing `markdownToDocument`), Tailwind, lucide-react, vitest under Electron (`pnpm test`).

---

## Decisions (settled in the grill session, 2026-09-25)

| # | Decision |
|---|----------|
| 1 | Scope: **auto-memory only**. No CLAUDE.md files. |
| 2 | Display: **in Dash, list + preview**, read-only. Editing goes to the external editor. |
| 3 | Container: **modal**, like Extensions. Opened for a **project**. Worktree tasks share their repo's memory. |
| 4 | Entry points: **sidebar footer button** (both layouts), **`openMemory` keybinding (mod+shift+M)**, **project "…" menu**, **task "…" menus**. A task menu opens its parent project's memory. |
| 5 | Encoder: **fix the shared `encodeProjectPath`** to match Claude Code: `[^a-zA-Z0-9]` becomes `-`, and names over 200 characters are cut to 200 and get a `-<base36 abs(javaHash)>` suffix. This also fixes the transcript/token-stats lookup for `.claude/worktrees/` tasks. |
| 6 | Memory root: **git main-checkout root** (the parent of `--git-common-dir` when that ends in `.git`), **falling back to `project.path`**. |
| 7 | Overrides: honour **`CLAUDE_CONFIG_DIR`** through `claudePaths.ts`, which owns Claude's whole user-config layout. This PR moves only the projects- and jobs-related consumers; the rest are follow-up #188. Don't read `autoMemoryDirectory`. |
| 8 | List: **grouped by type** (User, Feedback, Project, Reference, Other), **newest first** within a group. Search filters on name, description and body. `MEMORY.md` is pinned as "Index". Both frontmatter shapes are parsed (`type:` at the top level, or under `metadata:`). |
| 9 | Preview: **rendered markdown with clickable `[[name]]` and relative `*.md` links**, kept in the sandboxed iframe and wired back through `postMessage`. No sanitiser dependency. Frontmatter is shown as a React header. |
| 10 | Freshness: **watch only while the modal is open, one project at a time**. |
| 11 | Actions: **Open in editor** (the memory, or the folder via the preferred IDE), **reveal folder**, **copy path**. No delete, no send-to-task. |
| 12 | Empty state: **explain + show the exact path that was checked** (copyable), and mention `autoMemoryDirectory`/`autoMemoryEnabled`. Dash doesn't read settings to diagnose this. |
| 13 | The modal treats the index and the memories as one `MemoryDoc` list, converted in the renderer (`memoryDocs`). Search filters the list only; the preview changes only on click. |
| 14 | Follow-ups (a separate issue): an "N new memories" badge on project rows with always-on watchers, and "Send to task prompt". |

Ground truth used for 5–6: the Claude Code 2.1.282 binary contains `function E(e){let r=e.replace(/[^a-zA-Z0-9]/g,"-");if(r.length<=200)return r;return\`${r.slice(0,200)}-${Math.abs(yX(e)).toString(36)}\`}` with `yX` = Java `String.hashCode`. On disk, worktree project dirs (`…--claude-worktrees-…`) have no `memory/`; the main repo dir does.

## File map

**Create**
- `src/main/utils/claudePaths.ts`: Claude Code's user-config layout. It holds `claudeConfigDir()` (the one place `CLAUDE_CONFIG_DIR` is read), `encodeProjectPath()` (moved from `jsonlParser.ts`) and `claudeProjectDir(cwd)`.
- `src/main/services/memoryFiles.ts`: pure parsing (`parseMemoryFile`, `parseIndexLinks`, `toMemoryType`).
- `src/main/services/MemoryService.ts`: `resolveMemoryRoot`, `memoryDirFor`, `readProjectMemory`.
- `src/main/services/MemoryWatcher.ts`: a single modal-scoped watcher (`watchProjectMemory`, `stopWatchingMemory`).
- `src/main/ipc/memoryIpc.ts`: `memory:get`, `memory:watch`, `memory:unwatch`, `memory:openDir`.
- `src/types/electron-api/memory.ts`: `MemoryApi`.
- `src/renderer/components/memory/memoryView.ts`: pure view logic (grouping, search, link rewriting, preview script).
- `src/renderer/components/memory/useProjectMemory.ts`: loads the memory, subscribes, and manages the watch lifecycle.
- `src/renderer/components/memory/MemoryPreview.tsx`: iframe + postMessage bridge.
- `src/renderer/components/memory/MemoryModal.tsx`: the modal.
- Tests: `src/main/utils/__tests__/claudePaths.test.ts`, `src/main/services/__tests__/memoryFiles.test.ts`, `src/main/services/__tests__/MemoryService.test.ts`, `src/main/services/__tests__/MemoryWatcher.test.ts`, `src/main/ipc/__tests__/memoryIpc.test.ts`, `src/renderer/components/memory/__tests__/memoryView.test.ts`.

**Modify**
- `src/main/utils/jsonlParser.ts:12-23`: the encoder moves out, and its tests (`jsonlParser.test.ts:137-159`) move to `claudePaths.test.ts`.
- `src/main/services/SupervisorService.ts:50-54`, `src/main/services/claudeCli.ts:13-22`, `src/main/utils/taskTokenAggregator.ts:36` (and its test): use `claudePaths`.
- `src/main/services/skillFrontmatter.ts`: export `stripQuotes`.
- `src/shared/types.ts`: `MemoryType`, `MemoryEntry`, `ProjectMemory`.
- `src/main/ipc/index.ts`, `src/main/preload.ts`, `src/types/electron-api.d.ts`, `src/main/main.ts` (quit cleanup).
- `src/renderer/components/diffEditor/editor/markdownPreview.ts`: optional `extraHead`.
- `src/renderer/stores/uiStore.ts`: `memoryProjectId`.
- `src/renderer/keybindings.ts`: `openMemory`.
- `src/renderer/App.tsx`: mount the modal and handle the keybinding.
- `src/renderer/components/leftSidebar/LeftSidebar.tsx`, `ProjectsSection.tsx`, `src/renderer/components/task/TaskMenuItems.tsx`, `TaskActions.tsx`, `TaskCard.tsx`, `src/renderer/components/project/ProjectOverview.tsx`, `src/renderer/components/MainContent.tsx`: entry points.

Run one test file with: `pnpm test src/path/to/file.test.ts`. Never `npm rebuild` (see CLAUDE.md: native modules are built for Electron's ABI).

---

### Task 1: `claudePaths.ts`: move `encodeProjectPath` there and make it match Claude Code

`src/main/utils/claudePaths.ts` is the single owner of Claude Code's **user config** layout: everything under `CLAUDE_CONFIG_DIR` / `~/.claude`. A project's or worktree's own `<repo>/.claude/…` folder is a different concept and stays where it is. This PR moves only the projects-related consumers. Issue #188 covers the other user-config paths (skills, plugins, global settings).

**Files:**
- Create: `src/main/utils/claudePaths.ts`, `src/main/utils/__tests__/claudePaths.test.ts`
- Modify: `src/main/utils/jsonlParser.ts:12-23` (delete the encoder), `src/main/utils/__tests__/jsonlParser.test.ts` (delete the `encodeProjectPath` import and its `describe` block at 137-159), `src/main/services/claudeCli.ts:6`, `src/main/utils/taskTokenAggregator.ts:4-9`, `src/main/utils/__tests__/taskTokenAggregator.test.ts` (import)

- [ ] **Step 1: Write the failing test** `src/main/utils/__tests__/claudePaths.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { encodeProjectPath } from '../claudePaths';

describe('encodeProjectPath', () => {
  // Real directory names Claude Code 2.1.282 created under ~/.claude/projects.
  it.each([
    ['/home/fabian-scott/Documents/Git-Projects/dash', '-home-fabian-scott-Documents-Git-Projects-dash'],
    [
      '/home/fabian-scott/Documents/Git-Projects/dash/.claude/worktrees/claude-s-memories-f6c',
      '-home-fabian-scott-Documents-Git-Projects-dash--claude-worktrees-claude-s-memories-f6c',
    ],
  ])('encodes %s like Claude Code', (input, expected) => {
    expect(encodeProjectPath(input)).toBe(expected);
  });

  it('hyphenates every non-alphanumeric character, on every platform', () => {
    expect(encodeProjectPath('/tmp/a:b_c d.e')).toBe('-tmp-a-b-c-d-e');
    expect(encodeProjectPath('C:\\Users\\foo')).toBe('C--Users-foo');
  });

  it('truncates names over 200 chars and appends a base36 hash of the raw path', () => {
    const long = '/home/u/' + 'very-long-directory-name/'.repeat(9) + 'repo';
    expect(encodeProjectPath(long)).toBe(
      '-home-u-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directo-xabdzz',
    );
  });

  it('leaves names of exactly 200 chars untouched', () => {
    const p = '/' + 'a'.repeat(199);
    expect(encodeProjectPath(p)).toBe('-' + 'a'.repeat(199));
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm test src/main/utils/__tests__/claudePaths.test.ts`
Expected: FAIL, "Cannot find module '../claudePaths'".

- [ ] **Step 3: Implement.** Create `src/main/utils/claudePaths.ts`:

```ts
/**
 * Claude Code's user-config layout (`CLAUDE_CONFIG_DIR`, else `~/.claude`):
 * the one module that knows where Claude keeps per-user state on disk. A
 * project's own `<repo>/.claude/` folder is a different thing and lives with
 * its consumers.
 */

/** Claude Code caps encoded dir names at this length and appends a hash. */
const MAX_ENCODED_LENGTH = 200;

/** Java's `String.hashCode` — the hash Claude Code uses for the overflow suffix. */
function javaStringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Encode a cwd to the directory name Claude Code uses under `projects/`:
 * every non-alphanumeric character becomes `-` (so `/`, `\`, `:` and the `.`
 * of `.claude/worktrees` alike), and names past 200 characters are cut and
 * suffixed with a base36 hash of the raw path. Mirrors Claude Code 2.1.x
 * exactly; a mismatch makes transcript and memory lookups silently miss.
 */
export function encodeProjectPath(absolutePath: string): string {
  const encoded = absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
  if (encoded.length <= MAX_ENCODED_LENGTH) return encoded;
  const hash = Math.abs(javaStringHash(absolutePath)).toString(36);
  return `${encoded.slice(0, MAX_ENCODED_LENGTH)}-${hash}`;
}
```

Delete `encodeProjectPath` and its doc comment from `src/main/utils/jsonlParser.ts`. Delete the `encodeProjectPath` import and `describe` block from `jsonlParser.test.ts`. Repoint the importers (no re-export shim):
- `src/main/services/claudeCli.ts:6` → `import { encodeProjectPath } from '../utils/claudePaths';`
- `src/main/utils/taskTokenAggregator.ts`: remove `encodeProjectPath` from the `./jsonlParser` import list and add `import { encodeProjectPath } from './claudePaths';`
- `src/main/utils/__tests__/taskTokenAggregator.test.ts`: import `encodeProjectPath` from `'../claudePaths'`

- [ ] **Step 4: Run the tests**

Run: `pnpm test src/main/utils src/main/services/__tests__/claudeCli.test.ts && pnpm type-check`
Expected: PASS. If a dependant test hard-codes an old-style encoding such as `-repo-.claude-…`, update the fixture to the new encoding. That old value was the bug.

- [ ] **Step 5: Commit**

```bash
git add src/main/utils src/main/services/claudeCli.ts
git commit -m "Encode project dirs exactly like Claude Code, in a claudePaths module

Dash only hyphenated '/', so every .claude/worktrees task encoded to a
dir Claude never writes (it hyphenates all non-alphanumerics and hashes
names past 200 chars), and transcript and token-stat lookups missed. The
encoder moves out of the JSONL parser into claudePaths, which owns
Claude's user-config layout."
```

---

### Task 2: `claudeConfigDir()` + `claudeProjectDir()`, and move the projects-related consumers over

**Files:**
- Modify: `src/main/utils/claudePaths.ts`, `src/main/utils/__tests__/claudePaths.test.ts`, `src/main/services/SupervisorService.ts:50-54`, `src/main/services/claudeCli.ts:13-22`, `src/main/utils/taskTokenAggregator.ts:36`, `src/main/utils/__tests__/taskTokenAggregator.test.ts:22,119`

- [ ] **Step 1: Write the failing tests** (append to `claudePaths.test.ts`, and add `afterEach`, `os`, `path` to the imports)

```ts
import { afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { claudeConfigDir, claudeProjectDir } from '../claudePaths';

describe('claudeConfigDir / claudeProjectDir', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
  });

  it('defaults to ~/.claude', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(claudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });

  it('honours CLAUDE_CONFIG_DIR, treating empty as unset', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/alt-claude';
    expect(claudeConfigDir()).toBe('/tmp/alt-claude');
    process.env.CLAUDE_CONFIG_DIR = '';
    expect(claudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });

  it('places a cwd under <config dir>/projects/<encoded>', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/alt-claude';
    expect(claudeProjectDir('/repo/.claude/worktrees/x')).toBe(
      '/tmp/alt-claude/projects/-repo--claude-worktrees-x',
    );
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm test src/main/utils/__tests__/claudePaths.test.ts`
Expected: FAIL, `claudeConfigDir` is not exported.

- [ ] **Step 3: Implement and move the consumers.** Add to `claudePaths.ts` (plus `import * as os from 'os'; import * as path from 'path';`):

```ts
/** Claude Code's config root: `CLAUDE_CONFIG_DIR` when set, else `~/.claude`.
 *  Read per call so a changed env is picked up without a restart. */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/** Where Claude keeps a cwd's transcripts (and, for a repo root, its `memory/`). */
export function claudeProjectDir(cwd: string): string {
  return path.join(claudeConfigDir(), 'projects', encodeProjectPath(cwd));
}
```

Consumers:
- `SupervisorService.ts` `jobsDir()` → `return path.join(claudeConfigDir(), 'jobs');` (doc: "`<claude config dir>/jobs`: watched as a change trigger only."). Import from `'../utils/claudePaths'`. Drop `os` if it's now unused.
- `claudeCli.ts` `findClaudeProjectDir` → `const pathBased = claudeProjectDir(cwd);`. Delete the `projectsDir` local, and drop `os` and `encodeProjectPath` imports if they're now unused.
- `taskTokenAggregator.ts:36` → `const projectDir = claudeProjectDir(p);`. Drop `os`, `path` and `encodeProjectPath` imports if they're now unused.
- `taskTokenAggregator.test.ts`: the tests set `HOME`, so add `delete process.env.CLAUDE_CONFIG_DIR` to `beforeEach` (restoring it in `afterEach`), and replace the two hand-built paths at :22 and :119 with `claudeProjectDir(taskPath)`.

- [ ] **Step 4: Run the tests**

Run: `pnpm test src/main/utils src/main/services/__tests__/SupervisorService.test.ts src/main/services/__tests__/claudeCli.test.ts && pnpm type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/utils src/main/services/SupervisorService.ts src/main/services/claudeCli.ts
git commit -m "Resolve Claude's projects and jobs dirs through claudePaths, honouring CLAUDE_CONFIG_DIR"
```

---

### Task 3: Shared types + pure memory-file parsing

**Files:**
- Modify: `src/shared/types.ts` (append), `src/main/services/skillFrontmatter.ts` (export `stripQuotes`)
- Create: `src/main/services/memoryFiles.ts`
- Test: `src/main/services/__tests__/memoryFiles.test.ts`

- [ ] **Step 1: Add the shared types** (append to `src/shared/types.ts`)

```ts
/** Claude Code auto-memory categories; `other` catches missing or unknown types. */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference', 'other'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** One `<name>.md` file in a project's auto-memory folder. */
export interface MemoryEntry {
  /** Basename, e.g. `feedback_testing.md`: the stable id within a folder. */
  file: string;
  /** Frontmatter `name`, falling back to the basename without `.md`. */
  name: string;
  description: string;
  type: MemoryType;
  /** Markdown without the frontmatter block. */
  body: string;
  mtimeMs: number;
  /** Whether MEMORY.md links to this file. */
  inIndex: boolean;
}

/** A project's auto-memory, as Claude Code stores it. */
export interface ProjectMemory {
  /** Absolute memory folder Dash resolved (shown even when it doesn't exist). */
  dir: string;
  exists: boolean;
  /** MEMORY.md contents, or null when absent. */
  index: string | null;
  entries: MemoryEntry[];
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseMemoryFile, parseIndexLinks, toMemoryType } from '../memoryFiles';

describe('parseMemoryFile', () => {
  it('reads the current shape (type under metadata:)', () => {
    const md = [
      '---',
      'name: prefer-ci',
      'description: Run tests in CI, not locally',
      'metadata:',
      '  type: feedback',
      '---',
      '',
      'Body **here**.',
    ].join('\n');
    expect(parseMemoryFile(md)).toEqual({
      name: 'prefer-ci',
      description: 'Run tests in CI, not locally',
      type: 'feedback',
      body: '\nBody **here**.',
    });
  });

  it('reads the legacy shape (top-level type, quoted values, extra keys)', () => {
    const md = [
      '---',
      'name: "Keep fixes scoped"',
      "description: 'Scope = the active iteration'",
      'type: project',
      'originSessionId: 6eabdf28',
      '---',
      'Body',
    ].join('\n');
    const parsed = parseMemoryFile(md);
    expect(parsed.name).toBe('Keep fixes scoped');
    expect(parsed.description).toBe('Scope = the active iteration');
    expect(parsed.type).toBe('project');
    expect(parsed.body).toBe('Body');
  });

  it('treats a file without frontmatter as an untyped body', () => {
    expect(parseMemoryFile('# Just notes')).toEqual({
      name: '',
      description: '',
      type: 'other',
      body: '# Just notes',
    });
  });

  it('handles CRLF line endings', () => {
    const md = '---\r\nname: a\r\ntype: user\r\n---\r\nbody';
    expect(parseMemoryFile(md)).toMatchObject({ name: 'a', type: 'user', body: 'body' });
  });
});

describe('toMemoryType', () => {
  it('maps unknown or empty values to other', () => {
    expect(toMemoryType('reference')).toBe('reference');
    expect(toMemoryType('Feedback')).toBe('feedback');
    expect(toMemoryType('bogus')).toBe('other');
    expect(toMemoryType('')).toBe('other');
  });
});

describe('parseIndexLinks', () => {
  it('collects the .md basenames the index links to', () => {
    const index = [
      '- [Profile](user_profile.md) — who the user is',
      '- [CI](feedback_ci.md) — see also [x](https://example.com/a.md)',
      '- [Nested](sub/dir/thing.md)',
    ].join('\n');
    expect(parseIndexLinks(index)).toEqual(
      new Set(['user_profile.md', 'feedback_ci.md', 'thing.md']),
    );
  });
});
```

(Links containing `://` are skipped. Nested links resolve to their basename, because Claude only writes flat folders.)

- [ ] **Step 3: Run it and check it fails**

Run: `pnpm test src/main/services/__tests__/memoryFiles.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

In `src/main/services/skillFrontmatter.ts`, change `function stripQuotes` to `export function stripQuotes`.

`src/main/services/memoryFiles.ts`:

```ts
import * as path from 'path';
import { MEMORY_TYPES, type MemoryType } from '@shared/types';
import { stripQuotes } from './skillFrontmatter';

/** The index file Claude keeps beside the memories. */
export const MEMORY_INDEX_FILE = 'MEMORY.md';

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export interface ParsedMemory {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
}

export function toMemoryType(raw: string): MemoryType {
  const t = raw.trim().toLowerCase();
  return (MEMORY_TYPES as readonly string[]).includes(t) ? (t as MemoryType) : 'other';
}

/**
 * Read a memory file's frontmatter. Two shapes exist on disk: older files put
 * `type:` at the top level; newer ones nest it under `metadata:`. `name` and
 * `description` are only taken at the top level so a nested key can't shadow
 * them. Not a YAML parser — the repo has none, and these files are flat.
 */
export function parseMemoryFile(content: string): ParsedMemory {
  const m = FRONTMATTER_RE.exec(content);
  const out: ParsedMemory = {
    name: '',
    description: '',
    type: 'other',
    body: m ? content.slice(m[0].length) : content,
  };
  if (!m?.[1]) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, indent, key, raw = ''] = kv;
    const value = stripQuotes(raw);
    if (!indent && key === 'name') out.name = value;
    else if (!indent && key === 'description') out.description = value;
    else if (key === 'type') out.type = toMemoryType(value);
  }
  return out;
}

/** Basenames of the local `.md` files MEMORY.md links to. */
export function parseIndexLinks(index: string): Set<string> {
  const files = new Set<string>();
  for (const match of index.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
    const target = match[1];
    if (!target || target.includes('://')) continue;
    files.add(path.basename(target));
  }
  return files;
}
```

- [ ] **Step 5: Run it and check it passes**

Run: `pnpm test src/main/services/__tests__/memoryFiles.test.ts src/main/services/__tests__/skillFrontmatter.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/services/skillFrontmatter.ts src/main/services/memoryFiles.ts src/main/services/__tests__/memoryFiles.test.ts
git commit -m "Parse Claude auto-memory files and their index"
```

---

### Task 4: `MemoryService`: resolve and read a project's memory

**Files:**
- Create: `src/main/services/MemoryService.ts`
- Test: `src/main/services/__tests__/MemoryService.test.ts`

- [ ] **Step 1: Write the failing test** (a real temp git repo + linked worktree, and a temp `CLAUDE_CONFIG_DIR`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { claudeProjectDir } from '../../utils/claudePaths';
import { resolveMemoryRoot, memoryDirFor, readProjectMemory } from '../MemoryService';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
}

let tmp: string;
let repo: string;
let worktree: string;
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-memory-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, 'packages', 'web'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  worktree = path.join(repo, '.claude', 'worktrees', 'feat-abc');
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', worktree);
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
});

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveMemoryRoot', () => {
  it('returns the repo root for the repo itself', async () => {
    expect(await resolveMemoryRoot(repo)).toBe(repo);
  });
  it('returns the main checkout for a linked worktree', async () => {
    expect(await resolveMemoryRoot(worktree)).toBe(repo);
  });
  it('returns the repo root for a subfolder project', async () => {
    expect(await resolveMemoryRoot(path.join(repo, 'packages', 'web'))).toBe(repo);
  });
  it('falls back to the path itself outside git', async () => {
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    expect(await resolveMemoryRoot(plain)).toBe(plain);
  });
});

describe('memoryDirFor', () => {
  it('places the folder in the root\'s Claude project dir', () => {
    expect(memoryDirFor(repo)).toBe(
      path.join(claudeProjectDir(repo), 'memory'),
    );
  });
});

describe('readProjectMemory', () => {
  it('reports a missing folder without throwing', async () => {
    const memory = await readProjectMemory(repo);
    expect(memory).toEqual({ dir: memoryDirFor(repo), exists: false, index: null, entries: [] });
  });

  it('reads entries, the index, and index membership, from a worktree path', async () => {
    const dir = memoryDirFor(repo);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '- [CI](feedback_ci.md) — hook\n');
    fs.writeFileSync(
      path.join(dir, 'feedback_ci.md'),
      '---\nname: prefer-ci\ndescription: CI over local\nmetadata:\n  type: feedback\n---\nUse CI.',
    );
    fs.writeFileSync(path.join(dir, 'orphan.md'), 'no frontmatter');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');

    const memory = await readProjectMemory(worktree);
    expect(memory.exists).toBe(true);
    expect(memory.index).toContain('feedback_ci.md');
    const byFile = Object.fromEntries(memory.entries.map((e) => [e.file, e]));
    expect(Object.keys(byFile).sort()).toEqual(['feedback_ci.md', 'orphan.md']);
    expect(byFile['feedback_ci.md']).toMatchObject({
      name: 'prefer-ci',
      description: 'CI over local',
      type: 'feedback',
      body: 'Use CI.',
      inIndex: true,
    });
    expect(byFile['orphan.md']).toMatchObject({ name: 'orphan', type: 'other', inIndex: false });
    expect(byFile['orphan.md']!.mtimeMs).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm test src/main/services/__tests__/MemoryService.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/main/services/MemoryService.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { MemoryEntry, ProjectMemory } from '@shared/types';
import { claudeProjectDir } from '../utils/claudePaths';
import { MEMORY_INDEX_FILE, parseIndexLinks, parseMemoryFile } from './memoryFiles';

const execFileAsync = promisify(execFile);

/**
 * The directory Claude Code keys a project's auto-memory by: the main
 * checkout of the git repo `projectPath` lives in, so every linked worktree
 * (and a monorepo subfolder) shares one memory. Outside git, the path itself.
 */
export async function resolveMemoryRoot(projectPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: projectPath },
    );
    const commonDir = stdout.trim();
    return path.basename(commonDir) === '.git' ? path.dirname(commonDir) : projectPath;
  } catch {
    return projectPath;
  }
}

export function memoryDirFor(memoryRoot: string): string {
  return path.join(claudeProjectDir(memoryRoot), 'memory');
}

async function readEntry(dir: string, file: string, indexed: Set<string>): Promise<MemoryEntry | null> {
  const full = path.join(dir, file);
  try {
    const [content, stat] = await Promise.all([
      fs.promises.readFile(full, 'utf8'),
      fs.promises.stat(full),
    ]);
    const parsed = parseMemoryFile(content);
    return {
      file,
      name: parsed.name || file.replace(/\.md$/, ''),
      description: parsed.description,
      type: parsed.type,
      body: parsed.body,
      mtimeMs: stat.mtimeMs,
      inIndex: indexed.has(file),
    };
  } catch {
    // Deleted between readdir and read (Claude rewrites memories mid-session).
    return null;
  }
}

/** Read the project's memory folder. A missing folder is a normal state, not an error. */
export async function readProjectMemory(projectPath: string): Promise<ProjectMemory> {
  const dir = memoryDirFor(await resolveMemoryRoot(projectPath));
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return { dir, exists: false, index: null, entries: [] };
  }
  const index = names.includes(MEMORY_INDEX_FILE)
    ? await fs.promises.readFile(path.join(dir, MEMORY_INDEX_FILE), 'utf8').catch(() => null)
    : null;
  const indexed = index ? parseIndexLinks(index) : new Set<string>();
  const entries = await Promise.all(
    names
      .filter((n) => n.endsWith('.md') && n !== MEMORY_INDEX_FILE)
      .map((file) => readEntry(dir, file, indexed)),
  );
  return {
    dir,
    exists: true,
    index,
    entries: entries.filter((e): e is MemoryEntry => e !== null),
  };
}
```

- [ ] **Step 4: Run it and check it passes**

Run: `pnpm test src/main/services/__tests__/MemoryService.test.ts`
Expected: PASS. If `resolveMemoryRoot(repo)` returns a path with a different realpath on macOS (`/private/var` vs `/var`), that's why the test uses `fs.realpathSync` on the tmp dir. Keep it.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/MemoryService.ts src/main/services/__tests__/MemoryService.test.ts
git commit -m "Resolve and read a project's Claude auto-memory"
```

---

### Task 5: `MemoryWatcher`: one watcher, only while the modal is open

**Files:**
- Create: `src/main/services/MemoryWatcher.ts`
- Modify: `src/main/main.ts` (quit cleanup, next to the PortsConfigWatcher block around line 372)
- Test: `src/main/services/__tests__/MemoryWatcher.test.ts`

Why it watches an ancestor: the `memory/` folder (and even the encoded project folder) may not exist yet when the modal opens. `fs.watch` on a missing path throws, so the watcher attaches to the nearest folder that does exist. Once the memory folder appears, it moves the watch there. The same reasoning is in `PortsConfigWatcher.ts:40-47`.

- [ ] **Step 1: Write the failing test** (inject the notifier so the test doesn't need `BrowserWindow`)

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

import { watchProjectMemory, stopWatchingMemory, setMemoryChangeNotifier } from '../MemoryWatcher';
import { memoryDirFor } from '../MemoryService';

let tmp: string;
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-memwatch-')));
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
  fs.mkdirSync(path.join(tmp, 'claude'), { recursive: true });
});

afterEach(() => {
  stopWatchingMemory();
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('MemoryWatcher', () => {
  it('notifies when a memory is written into an existing folder', async () => {
    const project = path.join(tmp, 'plain-a');
    fs.mkdirSync(project);
    const dir = memoryDirFor(project);
    fs.mkdirSync(dir, { recursive: true });
    const seen: string[] = [];
    setMemoryChangeNotifier((p) => seen.push(p));
    await watchProjectMemory(project);
    fs.writeFileSync(path.join(dir, 'a.md'), 'x');
    await waitFor(() => seen.length > 0);
    expect(seen).toEqual([project]);
  });

  it('picks up a memory folder created after the watch started', async () => {
    const project = path.join(tmp, 'plain-b');
    fs.mkdirSync(project);
    const seen: string[] = [];
    setMemoryChangeNotifier((p) => seen.push(p));
    await watchProjectMemory(project);
    const dir = memoryDirFor(project);
    fs.mkdirSync(dir, { recursive: true });
    await waitFor(() => seen.length > 0);
    seen.length = 0;
    fs.writeFileSync(path.join(dir, 'late.md'), 'x');
    await waitFor(() => seen.length > 0);
    expect(seen[0]).toBe(project);
  });

  it('stops notifying after stopWatchingMemory', async () => {
    const project = path.join(tmp, 'plain-c');
    fs.mkdirSync(project);
    const dir = memoryDirFor(project);
    fs.mkdirSync(dir, { recursive: true });
    const seen: string[] = [];
    setMemoryChangeNotifier((p) => seen.push(p));
    await watchProjectMemory(project);
    stopWatchingMemory();
    fs.writeFileSync(path.join(dir, 'b.md'), 'x');
    await new Promise((r) => setTimeout(r, 600));
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm test src/main/services/__tests__/MemoryWatcher.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/main/services/MemoryWatcher.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { memoryDirFor, resolveMemoryRoot } from './MemoryService';

// Claude writes a memory and then its MEMORY.md line in quick succession;
// one refresh covers both.
const DEBOUNCE_MS = 300;

interface ActiveWatch {
  projectPath: string;
  memoryDir: string;
  watcher: fs.FSWatcher | null;
  watchedDir: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

// One watch at a time: it exists only while the memory modal is open, and the
// modal shows one project.
let active: ActiveWatch | null = null;
// Bumped by every watch/stop so an await that resolves late can't arm a
// watcher for a modal that has since closed or switched project.
let generation = 0;

let notify = (projectPath: string): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('memory:changed', projectPath);
  }
};

/** Test seam: replace the renderer broadcast. */
export function setMemoryChangeNotifier(fn: (projectPath: string) => void): void {
  notify = fn;
}

/** The memory dir itself, or its nearest existing ancestor. */
function nearestExisting(dir: string): string | null {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(d)) return d;
    if (path.dirname(d) === d) return null;
  }
}

function schedule(entry: ActiveWatch): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    notify(entry.projectPath);
  }, DEBOUNCE_MS);
}

function arm(entry: ActiveWatch): void {
  const target = nearestExisting(entry.memoryDir);
  if (!target || target === entry.watchedDir) return;
  entry.watcher?.close();
  entry.watcher = null;
  entry.watchedDir = null;
  try {
    entry.watcher = fs.watch(target, () => {
      // Watching an ancestor: re-aim at the memory dir once it exists.
      if (entry.watchedDir !== entry.memoryDir) arm(entry);
      schedule(entry);
    });
    entry.watcher.on('error', () => {}); // the folder may be deleted under us
    entry.watchedDir = target;
  } catch (err) {
    console.error('[MemoryWatcher] fs.watch failed', target, err);
  }
}

/** Watch `projectPath`'s memory folder, replacing any previous watch. */
export async function watchProjectMemory(projectPath: string): Promise<void> {
  stopWatchingMemory();
  const mine = ++generation;
  const memoryDir = memoryDirFor(await resolveMemoryRoot(projectPath));
  if (mine !== generation) return;
  active = { projectPath, memoryDir, watcher: null, watchedDir: null, timer: null };
  arm(active);
}

/** Close the watch. Idempotent; also called at quit. */
export function stopWatchingMemory(): void {
  generation++;
  if (!active) return;
  if (active.timer) clearTimeout(active.timer);
  try {
    active.watcher?.close();
  } catch {
    // already closed
  }
  active = null;
}
```

In `src/main/main.ts`, after the "Stop all ports.json watchers" block:

```ts
    // Stop the memory-modal watcher
    try {
      const { stopWatchingMemory } = await import('./services/MemoryWatcher');
      stopWatchingMemory();
    } catch {
      // Best effort
    }
```

- [ ] **Step 4: Run it and check it passes**

Run: `pnpm test src/main/services/__tests__/MemoryWatcher.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/MemoryWatcher.ts src/main/services/__tests__/MemoryWatcher.test.ts src/main/main.ts
git commit -m "Watch a project's memory folder while the memory view is open"
```

---

### Task 6: IPC + preload + API types

**Files:**
- Create: `src/main/ipc/memoryIpc.ts`, `src/types/electron-api/memory.ts`
- Modify: `src/main/ipc/index.ts`, `src/main/preload.ts`, `src/types/electron-api.d.ts`
- Test: `src/main/ipc/__tests__/memoryIpc.test.ts`

- [ ] **Step 1: Write the failing test** (schema-level, following `extensionsIpc.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { memoryProjectArgsSchema } from '../memoryIpc';

describe('memoryProjectArgsSchema', () => {
  it('accepts an absolute project path', () => {
    expect(() => memoryProjectArgsSchema.parse({ projectPath: '/repos/dash' })).not.toThrow();
  });
  it('rejects a relative path', () => {
    expect(() => memoryProjectArgsSchema.parse({ projectPath: 'repos/dash' })).toThrow();
  });
  it('rejects a missing path', () => {
    expect(() => memoryProjectArgsSchema.parse({})).toThrow();
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm test src/main/ipc/__tests__/memoryIpc.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the handler**

`src/main/ipc/memoryIpc.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { ipcMain, shell } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse, ipcError } from './validate';
import { memoryDirFor, readProjectMemory, resolveMemoryRoot } from '../services/MemoryService';
import { stopWatchingMemory, watchProjectMemory } from '../services/MemoryWatcher';

export const memoryProjectArgsSchema = z.object({
  projectPath: z.string().refine((p) => path.isAbsolute(p), 'must be an absolute path'),
});

export function registerMemoryIpc(): void {
  ipcMain.handle('memory:get', async (_event, raw: unknown) => {
    try {
      const { projectPath } = parseArgs('memory:get', memoryProjectArgsSchema, raw);
      return { success: true, data: await readProjectMemory(projectPath) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('memory:watch', async (_event, raw: unknown) => {
    try {
      const { projectPath } = parseArgs('memory:watch', memoryProjectArgsSchema, raw);
      await watchProjectMemory(projectPath);
      return { success: true, data: null };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('memory:unwatch', () => {
    stopWatchingMemory();
    return { success: true, data: null };
  });

  // Reveal the folder in the OS file manager. The dir is recomputed here, not
  // taken from the renderer, so this can only ever open a memory folder.
  ipcMain.handle('memory:openDir', async (_event, raw: unknown) => {
    try {
      const { projectPath } = parseArgs('memory:openDir', memoryProjectArgsSchema, raw);
      const dir = memoryDirFor(await resolveMemoryRoot(projectPath));
      if (!fs.existsSync(dir)) return ipcError(`No memory folder at ${dir}`, 'NOT_FOUND');
      const failure = await shell.openPath(dir);
      if (failure) return ipcError(failure, 'UNKNOWN');
      return { success: true, data: null };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
```

`src/main/ipc/index.ts`: add `import { registerMemoryIpc } from './memoryIpc';` and `registerMemoryIpc();` at the end of `registerAllIpc`.

`src/types/electron-api/memory.ts`:

```ts
import type { IpcResponse, ProjectMemory } from '../../shared/types';

/** Claude Code auto-memory for a project (read-only). */
export interface MemoryApi {
  memoryGet: (args: { projectPath: string }) => Promise<IpcResponse<ProjectMemory>>;
  memoryWatch: (args: { projectPath: string }) => Promise<IpcResponse<null>>;
  memoryUnwatch: () => Promise<IpcResponse<null>>;
  memoryOpenDir: (args: { projectPath: string }) => Promise<IpcResponse<null>>;
  /** Fires with the watched project's path; returns an unsubscribe. */
  onMemoryChanged: (callback: (projectPath: string) => void) => () => void;
}
```

`src/types/electron-api.d.ts`: add `import type { MemoryApi } from './electron-api/memory';` and add `MemoryApi` to the `extends` list.

`src/main/preload.ts`: add after the Token stats block:

```ts
  // Claude auto-memory
  memoryGet: (args: { projectPath: string }) => ipcRenderer.invoke('memory:get', args),
  memoryWatch: (args: { projectPath: string }) => ipcRenderer.invoke('memory:watch', args),
  memoryUnwatch: () => ipcRenderer.invoke('memory:unwatch'),
  memoryOpenDir: (args: { projectPath: string }) => ipcRenderer.invoke('memory:openDir', args),
  onMemoryChanged: (callback: (projectPath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, projectPath: string) =>
      callback(projectPath);
    ipcRenderer.on('memory:changed', handler);
    return () => {
      ipcRenderer.removeListener('memory:changed', handler);
    };
  },
```

- [ ] **Step 4: Run the tests and type-check**

Run: `pnpm test src/main/ipc/__tests__/memoryIpc.test.ts && pnpm type-check`
Expected: PASS, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/memoryIpc.ts src/main/ipc/__tests__/memoryIpc.test.ts src/main/ipc/index.ts src/main/preload.ts src/types/electron-api/memory.ts src/types/electron-api.d.ts
git commit -m "Expose project memory over IPC"
```

---

### Task 7: Renderer view logic (pure): grouping, search, link rewriting

**Files:**
- Create: `src/renderer/components/memory/memoryView.ts`
- Test: `src/renderer/components/memory/__tests__/memoryView.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { MemoryEntry, ProjectMemory } from '../../../../shared/types';
import {
  groupMemories,
  memoryDocs,
  pickCurrent,
  rewriteMemoryLinks,
  MEMORY_LINK_PREFIX,
} from '../memoryView';

function entry(p: Partial<MemoryEntry> & { file: string }): MemoryEntry {
  return {
    name: p.file.replace(/\.md$/, ''),
    description: '',
    type: 'other',
    body: '',
    mtimeMs: 0,
    inIndex: true,
    ...p,
  };
}

describe('groupMemories', () => {
  const entries = [
    entry({ file: 'a.md', type: 'feedback', mtimeMs: 1 }),
    entry({ file: 'b.md', type: 'feedback', mtimeMs: 5 }),
    entry({ file: 'c.md', type: 'user', mtimeMs: 2, description: 'Senior engineer' }),
    entry({ file: 'd.md', type: 'other', body: 'mentions Postgres' }),
  ];

  it('orders groups user → feedback → project → reference → other, newest first, skipping empty groups', () => {
    const groups = groupMemories(entries, '');
    expect(groups.map((g) => g.type)).toEqual(['user', 'feedback', 'other']);
    expect(groups[1]!.entries.map((e) => e.file)).toEqual(['b.md', 'a.md']);
  });

  it('filters case-insensitively on name, description, and body', () => {
    expect(groupMemories(entries, 'senior').flatMap((g) => g.entries.map((e) => e.file))).toEqual([
      'c.md',
    ]);
    expect(groupMemories(entries, 'POSTGRES').flatMap((g) => g.entries.map((e) => e.file))).toEqual(
      ['d.md'],
    );
  });
});

describe('memoryDocs / pickCurrent', () => {
  const memory: ProjectMemory = {
    dir: '/m',
    exists: true,
    index: '- [A](a.md)',
    entries: [
      entry({ file: 'a.md', type: 'feedback', mtimeMs: 1, body: 'A' }),
      entry({ file: 'b.md', type: 'user', mtimeMs: 2 }),
    ],
  };

  it('puts the index first as an untyped doc, then memories in list order', () => {
    const docs = memoryDocs(memory);
    expect(docs.map((d) => d.key)).toEqual(['MEMORY.md', 'b.md', 'a.md']);
    expect(docs[0]).toEqual({
      key: 'MEMORY.md',
      file: 'MEMORY.md',
      title: 'Index',
      markdown: '- [A](a.md)',
    });
    expect(docs[2]).toMatchObject({ title: 'a', markdown: 'A', type: 'feedback' });
  });

  it('keeps the selected doc', () => {
    expect(pickCurrent(memoryDocs(memory), 'a.md')?.key).toBe('a.md');
  });

  it('falls back to the index when the selected file was deleted', () => {
    expect(pickCurrent(memoryDocs(memory), 'gone.md')?.key).toBe('MEMORY.md');
  });

  it('falls back to the first memory in list order when there is no index', () => {
    expect(pickCurrent(memoryDocs({ ...memory, index: null }), null)?.key).toBe('b.md');
  });

  it('returns null for an empty folder', () => {
    expect(pickCurrent(memoryDocs({ ...memory, index: null, entries: [] }), null)).toBeNull();
  });
});

describe('rewriteMemoryLinks', () => {
  const entries = [
    entry({ file: 'feedback_ci.md', name: 'prefer-ci' }),
    entry({ file: 'user_profile.md', name: 'User profile, long title' }),
  ];

  it('resolves [[name]] by frontmatter name, then by basename', () => {
    const out = rewriteMemoryLinks('see [[prefer-ci]] and [[user_profile]]', entries);
    expect(out).toBe(
      `see [prefer-ci](${MEMORY_LINK_PREFIX}feedback_ci.md) and [user_profile](${MEMORY_LINK_PREFIX}user_profile.md)`,
    );
  });

  it('renders an unresolved [[name]] as escaped, muted text', () => {
    expect(rewriteMemoryLinks('[[<gone>]]', entries)).toBe(
      '<span class="memory-missing">&lt;gone&gt;</span>',
    );
  });

  it('rewrites relative links to known .md files and leaves others alone', () => {
    const md = '[CI](feedback_ci.md) [web](https://x.dev/a.md) [nope](missing.md)';
    expect(rewriteMemoryLinks(md, entries)).toBe(
      `[CI](${MEMORY_LINK_PREFIX}feedback_ci.md) [web](https://x.dev/a.md) [nope](missing.md)`,
    );
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm test src/renderer/components/memory/__tests__/memoryView.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/renderer/components/memory/memoryView.ts`

```ts
import type { MemoryEntry, MemoryType, ProjectMemory } from '../../../shared/types';

export const MEMORY_INDEX_KEY = 'MEMORY.md';

/** Href prefix the preview iframe intercepts and posts back to the modal. */
export const MEMORY_LINK_PREFIX = '#memory:';

/** Message the preview iframe posts when a memory link is clicked. */
export const MEMORY_LINK_MESSAGE = 'dash:memory-link';

const GROUP_ORDER: MemoryType[] = ['user', 'feedback', 'project', 'reference', 'other'];

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
  other: 'Other',
};

export interface MemoryGroup {
  type: MemoryType;
  entries: MemoryEntry[];
}

export function groupMemories(entries: MemoryEntry[], query: string): MemoryGroup[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? entries.filter((e) =>
        [e.name, e.description, e.body].some((f) => f.toLowerCase().includes(q)),
      )
    : entries;
  return GROUP_ORDER.map((type) => ({
    type,
    entries: matches.filter((e) => e.type === type).sort((a, b) => b.mtimeMs - a.mtimeMs),
  })).filter((g) => g.entries.length > 0);
}

/** What the modal lists and previews: a memory, or the MEMORY.md index (untyped). */
export interface MemoryDoc {
  key: string;
  file: string;
  title: string;
  markdown: string;
  type?: MemoryType;
  description?: string;
}

/**
 * The index and the memories as one uniform list, so the modal never branches
 * on "is this the index?". Order is the fallback order: the index first, then
 * memories in list order (group order, newest first).
 */
export function memoryDocs(memory: ProjectMemory): MemoryDoc[] {
  const docs: MemoryDoc[] =
    memory.index != null
      ? [{ key: MEMORY_INDEX_KEY, file: MEMORY_INDEX_KEY, title: 'Index', markdown: memory.index }]
      : [];
  for (const group of groupMemories(memory.entries, '')) {
    for (const e of group.entries) {
      docs.push({
        key: e.file,
        file: e.file,
        title: e.name,
        markdown: e.body,
        type: e.type,
        description: e.description,
      });
    }
  }
  return docs;
}

/** The chosen doc while it exists, else the first in fallback order. */
export function pickCurrent(docs: MemoryDoc[], selectedKey: string | null): MemoryDoc | null {
  return docs.find((d) => d.key === selectedKey) ?? docs[0] ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Point memory cross-references at `#memory:<file>` so the preview can route
 * clicks back into the modal. `[[name]]` resolves by frontmatter name, then by
 * basename; relative `(x.md)` links resolve only to files that exist.
 */
export function rewriteMemoryLinks(markdown: string, entries: MemoryEntry[]): string {
  const byName = new Map(entries.map((e) => [e.name, e.file]));
  const files = new Set(entries.map((e) => e.file));
  const resolve = (ref: string): string | undefined =>
    byName.get(ref) ?? (files.has(`${ref}.md`) ? `${ref}.md` : undefined);

  return markdown
    .replace(/\[\[([^\]\n]+)\]\]/g, (_m, ref: string) => {
      const file = resolve(ref.trim());
      return file
        ? `[${ref}](${MEMORY_LINK_PREFIX}${encodeURIComponent(file)})`
        : `<span class="memory-missing">${escapeHtml(ref)}</span>`;
    })
    .replace(/\]\(([^)\s:/]+\.md)\)/g, (m, file: string) =>
      files.has(file) ? `](${MEMORY_LINK_PREFIX}${encodeURIComponent(file)})` : m,
    );
}

/**
 * Injected into the preview document's <head>. `<base target=_blank>` sends
 * ordinary links to the window-open handler (→ system browser); memory links
 * are intercepted and posted to the parent. The iframe has no same-origin, so
 * postMessage is the only way out.
 */
export const MEMORY_PREVIEW_HEAD = `<base target="_blank" />
<style>.memory-missing{opacity:.55;text-decoration:underline dotted}</style>
<script>
document.addEventListener('click', function (e) {
  var a = e.target && e.target.closest && e.target.closest('a[href^="${MEMORY_LINK_PREFIX}"]');
  if (!a) return;
  e.preventDefault();
  var file = decodeURIComponent(a.getAttribute('href').slice(${MEMORY_LINK_PREFIX.length}));
  parent.postMessage({ type: '${MEMORY_LINK_MESSAGE}', file: file }, '*');
});
</script>`;
```

- [ ] **Step 4: Run it and check it passes**

Run: `pnpm test src/renderer/components/memory/__tests__/memoryView.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/memory/memoryView.ts src/renderer/components/memory/__tests__/memoryView.test.ts
git commit -m "Group, search, select, and cross-link memories for the memory view"
```

---

### Task 8: Preview component + `markdownToDocument` head hook

**Files:**
- Modify: `src/renderer/components/diffEditor/editor/markdownPreview.ts` (the `markdownToDocument` signature)
- Create: `src/renderer/components/memory/MemoryPreview.tsx`

- [ ] **Step 1: Add the optional `extraHead` parameter**

```ts
export function markdownToDocument(markdown: string, isDark: boolean, extraHead = ''): string {
  const body = marked.parse(markdown) as string;
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${previewStyles(isDark)}</style>${extraHead}</head><body>${body}</body></html>`;
}
```

Also add a sentence to the doc comment: "`extraHead` is appended to `<head>` (the memory preview injects its link bridge there)." The existing caller (`EditorPane.tsx:197`) doesn't change.

- [ ] **Step 2: Create** `src/renderer/components/memory/MemoryPreview.tsx`

```tsx
import { useEffect, useMemo, useRef } from 'react';
import type { MemoryEntry } from '../../../shared/types';
import { markdownToDocument } from '../diffEditor/editor/markdownPreview';
import { MEMORY_LINK_MESSAGE, MEMORY_PREVIEW_HEAD, rewriteMemoryLinks } from './memoryView';

interface Props {
  markdown: string;
  entries: MemoryEntry[];
  isDark: boolean;
  onOpenMemory: (file: string) => void;
}

/**
 * Rendered memory in the same sandboxed iframe as the editor's markdown
 * preview (scripts on, no same-origin — memory text is untrusted). Memory
 * links come back as postMessage; only messages from this iframe count.
 */
export function MemoryPreview({ markdown, entries, isDark, onOpenMemory }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const html = useMemo(
    () => markdownToDocument(rewriteMemoryLinks(markdown, entries), isDark, MEMORY_PREVIEW_HEAD),
    [markdown, entries, isDark],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const data = e.data as { type?: unknown; file?: unknown };
      if (data?.type === MEMORY_LINK_MESSAGE && typeof data.file === 'string') {
        onOpenMemory(data.file);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onOpenMemory]);

  return (
    <iframe
      ref={frameRef}
      title="Memory preview"
      srcDoc={html}
      sandbox="allow-scripts allow-popups"
      className="h-full w-full border-0"
    />
  );
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm type-check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/diffEditor/editor/markdownPreview.ts src/renderer/components/memory/MemoryPreview.tsx
git commit -m "Render memories in the sandboxed preview with in-app cross-links"
```

---

### Task 9: Data hook + modal + uiStore flag

**Files:**
- Modify: `src/renderer/stores/uiStore.ts`
- Create: `src/renderer/components/memory/useProjectMemory.ts`, `src/renderer/components/memory/MemoryModal.tsx`

- [ ] **Step 1: Add `memoryProjectId` to uiStore**

In `UiState`, after `extensionsInitialScopeId`:

```ts
  // Project whose Claude memory the memory modal shows; null → closed.
  memoryProjectId: string | null;
```

In `UiActions`: `setMemoryProjectId: (v: string | null) => void;`
In `initialState`: `memoryProjectId: null,`
In the store: `setMemoryProjectId: (v) => set({ memoryProjectId: v }),`

- [ ] **Step 2: Create** `src/renderer/components/memory/useProjectMemory.ts`

```ts
import { useEffect, useState } from 'react';
import type { ProjectMemory } from '../../../shared/types';

/** Load a project's memory and keep it live while mounted (the modal's lifetime). */
export function useProjectMemory(projectPath: string): {
  memory: ProjectMemory | null;
  error: string | null;
} {
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await window.electronAPI.memoryGet({ projectPath });
      if (cancelled) return;
      if (res.success && res.data) {
        setMemory(res.data);
        setError(null);
      } else {
        setError(res.error ?? 'Could not read memory');
      }
    };
    void load();
    void window.electronAPI.memoryWatch({ projectPath });
    const off = window.electronAPI.onMemoryChanged((changed) => {
      if (changed === projectPath) void load();
    });
    return () => {
      cancelled = true;
      off();
      void window.electronAPI.memoryUnwatch();
    };
  }, [projectPath]);

  return { memory, error };
}
```

- [ ] **Step 3: Create** `src/renderer/components/memory/MemoryModal.tsx`

```tsx
import { useCallback, useMemo, useState } from 'react';
import { Brain, Copy, ExternalLink, FolderOpen, Search, X } from 'lucide-react';
import type { Project } from '../../../shared/types';
import { formatRelativeTime } from '../../../shared/relativeTime';
import { Modal, useModalClose } from '../ui/Modal';
import { IconButton } from '../ui/IconButton';
import { openInIde } from '../../lib/openInIde';
import { MemoryPreview } from './MemoryPreview';
import { useProjectMemory } from './useProjectMemory';
import {
  groupMemories,
  memoryDocs,
  pickCurrent,
  MEMORY_INDEX_KEY,
  MEMORY_TYPE_LABELS,
} from './memoryView';

interface Props {
  project: Project;
  isDark: boolean;
  onClose: () => void;
}

export function MemoryModal({ project, isDark, onClose }: Props) {
  return (
    <Modal onClose={onClose} size="w-[1040px] max-w-[94vw] h-[86vh] max-h-[760px]">
      <MemoryBody project={project} isDark={isDark} />
    </Modal>
  );
}

function copy(text: string): void {
  window.electronAPI.clipboardWriteText(text);
}

function MemoryBody({ project, isDark }: { project: Project; isDark: boolean }) {
  const handleClose = useModalClose();
  const { memory, error } = useProjectMemory(project.path);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const entries = memory?.entries ?? [];
  const groups = useMemo(() => groupMemories(entries, query), [entries, query]);
  const docs = useMemo(() => (memory ? memoryDocs(memory) : []), [memory]);
  // Search filters the list only; the preview changes on click, never on typing.
  const current = pickCurrent(docs, selected);

  const openMemory = useCallback((file: string) => setSelected(file), []);
  const now = Date.now() / 1000;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border/40 px-5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="text-[14px] font-semibold tracking-tight text-foreground">Memory</h2>
          <span className="truncate font-mono text-[11px] text-fg-fade-40">{project.name}</span>
        </div>
        <div className="flex items-center gap-1">
          {memory?.exists && (
            <>
              <IconButton onClick={() => void openInIde(memory.dir)} title="Open folder in editor">
                <ExternalLink size={14} strokeWidth={1.8} />
              </IconButton>
              <IconButton
                onClick={() => void window.electronAPI.memoryOpenDir({ projectPath: project.path })}
                title="Reveal folder"
              >
                <FolderOpen size={14} strokeWidth={1.8} />
              </IconButton>
            </>
          )}
          {memory && (
            <IconButton onClick={() => copy(memory.dir)} title="Copy folder path">
              <Copy size={14} strokeWidth={1.8} />
            </IconButton>
          )}
          <IconButton onClick={handleClose} title="Close">
            <X size={14} strokeWidth={2} />
          </IconButton>
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b border-border/40 bg-destructive/10 px-5 py-2 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {memory && !memory.exists ? (
        <EmptyState dir={memory.dir} projectName={project.name} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[300px] shrink-0 flex-col border-r border-border/40">
            <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
              <Search size={14} strokeWidth={1.8} className="text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search memories"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-hidden placeholder:text-muted-foreground"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {memory?.index != null && !query && (
                <ListRow
                  active={current?.key === MEMORY_INDEX_KEY}
                  title="Index"
                  subtitle={MEMORY_INDEX_KEY}
                  onClick={() => setSelected(MEMORY_INDEX_KEY)}
                />
              )}
              {groups.map((g) => (
                <div key={g.type} className="mt-2">
                  <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {MEMORY_TYPE_LABELS[g.type]} · {g.entries.length}
                  </div>
                  {g.entries.map((e) => (
                    <ListRow
                      key={e.file}
                      active={current?.key === e.file}
                      title={e.name}
                      subtitle={e.description}
                      meta={formatRelativeTime(e.mtimeMs / 1000, now)}
                      flag={e.inIndex ? undefined : 'not indexed'}
                      onClick={() => setSelected(e.file)}
                    />
                  ))}
                </div>
              ))}
              {memory && groups.length === 0 && query && (
                <div className="px-3 py-4 text-[12px] text-muted-foreground">No matches</div>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {current && memory && (
              <>
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/40 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">
                        {current.title}
                      </span>
                      {current.type && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {MEMORY_TYPE_LABELS[current.type]}
                        </span>
                      )}
                    </div>
                    {current.description && (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">{current.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      onClick={() =>
                        void window.electronAPI.openInEditor({ cwd: memory.dir, filePath: current.file })
                      }
                      title="Open in editor"
                    >
                      <ExternalLink size={14} strokeWidth={1.8} />
                    </IconButton>
                    <IconButton onClick={() => copy(`${memory.dir}/${current.file}`)} title="Copy path">
                      <Copy size={14} strokeWidth={1.8} />
                    </IconButton>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <MemoryPreview
                    markdown={current.markdown}
                    entries={entries}
                    isDark={isDark}
                    onOpenMemory={openMemory}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ListRow(props: {
  active: boolean;
  title: string;
  subtitle?: string;
  meta?: string;
  flag?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      className={`block w-full px-3 py-1.5 text-left transition-colors ${
        props.active ? 'bg-accent' : 'hover:bg-accent/60'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{props.title}</span>
        {props.flag && <span className="shrink-0 text-[10px] text-fg-fade-40">{props.flag}</span>}
        {props.meta && <span className="shrink-0 text-[10px] text-fg-fade-40">{props.meta}</span>}
      </div>
      {props.subtitle && (
        <div className="truncate text-[11px] text-muted-foreground">{props.subtitle}</div>
      )}
    </button>
  );
}

function EmptyState({ dir, projectName }: { dir: string; projectName: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <Brain size={28} strokeWidth={1.5} className="text-muted-foreground" />
      <p className="text-[13px] text-foreground">No memories yet for {projectName}</p>
      <button
        onClick={() => copy(dir)}
        title="Copy path"
        className="max-w-full truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
      >
        {dir}
      </button>
      <p className="max-w-md text-[12px] text-muted-foreground">
        Claude writes memories here as it learns about the project. If you set{' '}
        <code>autoMemoryDirectory</code> or turned off <code>autoMemoryEnabled</code> in your
        Claude settings, they live elsewhere or are off.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Type-check + lint**

Run: `pnpm type-check && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/uiStore.ts src/renderer/components/memory/useProjectMemory.ts src/renderer/components/memory/MemoryModal.tsx
git commit -m "Add the memory modal"
```

---

### Task 10: Entry points: mount, keybinding, footer, project menu, task menus

**Files:**
- Modify: `src/renderer/keybindings.ts`, `src/renderer/App.tsx`, `src/renderer/components/leftSidebar/LeftSidebar.tsx`, `src/renderer/components/leftSidebar/ProjectsSection.tsx`, `src/renderer/components/task/TaskMenuItems.tsx`, `src/renderer/components/task/TaskActions.tsx`, `src/renderer/components/leftSidebar/TaskCard.tsx`, `src/renderer/components/project/ProjectOverview.tsx`, `src/renderer/components/MainContent.tsx`

- [ ] **Step 1: Keybinding.** In `DEFAULT_KEYBINDINGS` (`src/renderer/keybindings.ts`), after `openFolder`:

```ts
  openMemory: {
    id: 'openMemory',
    label: 'Claude Memory',
    category: 'Navigation',
    mod: true,
    shift: true,
    alt: false,
    key: 'm',
  },
```

Stored keybindings are merged onto the defaults (`keybindings.ts:142`), so existing users get the new binding automatically.

- [ ] **Step 2: Mount + shortcut in `App.tsx`.**

Near the other `useUi` selectors (around line 102):

```ts
  const memoryProjectId = useUi((s) => s.memoryProjectId);
  const setMemoryProjectId = useUi((s) => s.setMemoryProjectId);
  const memoryProject = projects.find((p) => p.id === memoryProjectId) ?? null;
```

In the keydown handler, after the `openFolder` block:

```ts
      if (keybindings.openMemory && matchesBinding(e, keybindings.openMemory)) {
        e.preventDefault();
        if (activeProjectId) setMemoryProjectId(memoryProjectId ? null : activeProjectId);
      }
```

Add `memoryProjectId` to that effect's dependency array.

Next to `{showSkillsBrowser && (<ExtensionsModal …/>)}`:

```tsx
      {memoryProject && (
        <MemoryModal
          project={memoryProject}
          isDark={theme === 'dark'}
          onClose={() => setMemoryProjectId(null)}
        />
      )}
```

with `import { MemoryModal } from './components/memory/MemoryModal';`. `Modal` already handles Esc (`Modal.tsx:76`), so the `closeDiff` chain needs no new branch.

- [ ] **Step 3: Sidebar footer (both layouts)** in `LeftSidebar.tsx`. Read the store directly, per `src/renderer/CLAUDE.md`, instead of adding a prop.

```ts
import { Plus, Settings, Blocks, Brain } from 'lucide-react';
import { useUi } from '../../stores/uiStore';
import { useProjects } from '../../stores/projectsStore';
// inside the component:
  const activeProjectId = useProjects((s) => s.activeProjectId);
  const setMemoryProjectId = useUi((s) => s.setMemoryProjectId);
```

(If `useProjects`/`useUi` are already imported there, reuse those imports.) Collapsed rail, after the Extensions `<Tooltip>`:

```tsx
        <Tooltip content={activeProjectId ? 'Claude memory' : 'Select a project to view its memory'}>
          <button
            onClick={() => activeProjectId && setMemoryProjectId(activeProjectId)}
            disabled={!activeProjectId}
            className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors titlebar-no-drag disabled:pointer-events-none disabled:opacity-50"
          >
            <Brain size={16} strokeWidth={1.5} />
          </button>
        </Tooltip>
```

Expanded footer, after the Extensions `IconButton`:

```tsx
        <IconButton
          onClick={() => activeProjectId && setMemoryProjectId(activeProjectId)}
          disabled={!activeProjectId}
          title={activeProjectId ? 'Claude memory' : 'Select a project to view its memory'}
          variant="muted"
          className="titlebar-no-drag"
        >
          <Brain size={14} strokeWidth={1.8} />
        </IconButton>
```

`IconButton` extends the native button attributes, so `disabled` passes straight through.

- [ ] **Step 4: Project "…" menu** in `ProjectsSection.tsx`, after the "Project settings" item (around line 409):

```tsx
                            <DropdownMenuItem onSelect={() => setMemoryProjectId(project.id)}>
                              <Brain size={13} strokeWidth={1.8} className="text-muted-foreground" />
                              Claude memory
                            </DropdownMenuItem>
```

with `Brain` added to the lucide import and `const setMemoryProjectId = useUi((s) => s.setMemoryProjectId);` in the component (import `useUi` from `../../stores/uiStore` if it isn't there already).

- [ ] **Step 5: Task menus.** `TaskMenuItems` is the shared item list for all three task menus (sidebar card, overview card, task header). Add the item there once.

`src/renderer/components/task/TaskMenuItems.tsx`:

```tsx
import { Settings, Archive, Trash2, Brain } from 'lucide-react';
import { useUi } from '../../stores/uiStore';
// …
export interface TaskMenuHandlers {
  /** The task's project: "Claude memory" opens it (worktrees share their repo's memory). */
  projectId: string;
  onOpenIde: () => void;
  onSettings: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function TaskMenuItems({ projectId, onOpenIde, onSettings, onArchive, onDelete }: TaskMenuHandlers) {
  const { ideId, openLabel } = usePreferredIde();
  const setMemoryProjectId = useUi((s) => s.setMemoryProjectId);
  return (
    <>
      {/* …existing IDE + Task settings items… */}
      <DropdownMenuItem onSelect={() => setMemoryProjectId(projectId)}>
        <Brain size={13} strokeWidth={1.8} className="text-muted-foreground" />
        Claude memory
      </DropdownMenuItem>
      {/* …existing Archive, separator, Delete… */}
    </>
  );
}
```

Then pass `projectId` through:
- `TaskActions.tsx`: add `projectId: string` to `TaskActionsProps`, destructure it, and pass `projectId={projectId}` to `<TaskMenuItems>`.
- `TaskCard.tsx:174`: `<TaskActions projectId={task.projectId} …>`.
- `ProjectOverview.tsx:416`: `<TaskActions projectId={task.projectId} …>`.
- `MainContent.tsx` (the task header `<TaskMenuItems>`): `projectId={activeTask.projectId}`.

Run `pnpm type-check` and it will point out any caller you missed.

- [ ] **Step 6: Type-check, lint, full test run**

Run: `pnpm type-check && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "Open Claude memory from the sidebar, project and task menus, and mod+shift+M"
```

---

### Task 11: Verify in the running app

- [ ] **Step 1:** Launch a dev instance beside the installed Dash (use the `run-dash` skill. `DASH_USER_DATA_DIR`/`DASH_DEV_URL` keep it separate).
- [ ] **Step 2:** Select the `dash` project and press mod+shift+M. Expect the Index to be pinned, then a "User · 1" group with `user_profile`. Take a screenshot.
- [ ] **Step 3:** Open a task's "…" menu, choose "Claude memory", and check that the same folder (the main repo's) is shown.
- [ ] **Step 4:** With the modal open, run `printf -- '---\nname: probe\ndescription: live test\nmetadata:\n  type: project\n---\nSee [[user_profile]].\n' > ~/.claude/projects/-home-fabian-scott-Documents-Git-Projects-dash/memory/probe.md`. It should appear under Project within about 300ms. Click the `user_profile` link and check it navigates. Then delete `probe.md` and check it disappears.
- [ ] **Step 5:** Open a project whose repo has no memory folder, and check the empty state shows the exact path.
- [ ] **Step 6:** Check that token stats now show for a `.claude/worktrees/` task, a side effect of Task 1 (the task card's usage/cost).
- [ ] **Step 7:** Commit any fixes. Push the branch and open a draft PR.

---

## Follow-up issue (file separately; not in this plan)

**"Memory: new-memory badge on project rows + send memory to task prompt"**
- Always-on watchers for all projects (cheap: one inotify/FSEvents watch per folder, no polling), an "N new" dot on a project row since its memory was last opened, and a persisted last-seen time per project.
- A "Send to task prompt" action that types `@<memory path> ` into the target task's agent pane without submitting. Target: the task the modal was opened from, else the active task if it's in the same project, else disabled.
