import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { CLONE_METHODS, getCloneMethod } from '@shared/cloneMethods';
import { useShallow } from 'zustand/react/shallow';
import { useProjects } from '../../stores/projectsStore';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { SettingRow } from '../ui/Field';
import { Input } from '../ui/Input';
import { useModalClose } from '../ui/Modal';
import { PathInput } from '../ui/PathInput';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import {
  classifySource,
  isPathInput,
  usualProjectsDir,
  type PathFacts,
  type Source,
} from './classifySource';
import { ScaffoldTerminal } from './ScaffoldTerminal';

interface NewProjectDialogProps {
  onClose: () => void;
  /** Called with the project's id once it is saved (or already was one). */
  onCreated: (projectId: string) => void;
}

/**
 * New project from one input: a folder path (existing repo, plain folder, or
 * one to create) or a git URL to clone. What it names decides the options
 * under it and the action; see `classifySource`. Task defaults live in
 * Project settings, not here.
 */
export function NewProjectDialog({ onClose, onCreated }: NewProjectDialogProps) {
  return (
    // Anchored to the top: the options under the input come and go as you
    // type, and a centred card would move the input with them.
    <Dialog size="lg" anchor="top" onClose={onClose}>
      <NewProjectBody onCreated={onCreated} />
    </Dialog>
  );
}

/** How long typing must pause before main looks at a path. */
const INSPECT_DEBOUNCE_MS = 150;

/** Main's facts about the path typed, once typing pauses. */
function usePathFacts(input: string): PathFacts | null {
  const [facts, setFacts] = useState<PathFacts | null>(null);
  useEffect(() => {
    const s = input.trim();
    if (!isPathInput(s)) return;
    let live = true;
    const timer = setTimeout(() => {
      void window.electronAPI.projectInspectPath(s).then((resp) => {
        if (live && resp.success && resp.data) setFacts(resp.data);
      });
    }, INSPECT_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [input]);
  return facts;
}

/** A value the user may edit, falling back to `fallback` whenever `key` changes. */
function useKeyedDraft<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [draft, setDraft] = useState<{ key: string; value: T } | null>(null);
  return [draft?.key === key ? draft.value : fallback, (value) => setDraft({ key, value })];
}

/** Identifies what the input names, so edits to its options reset with it. */
function sourceKey(source: Source): string {
  switch (source.kind) {
    case 'local-repo':
    case 'local-folder':
    case 'new-folder':
      return `${source.kind}:${source.path}`;
    case 'github':
    case 'ado':
    case 'other-git':
      return `remote:${source.url}`;
    case 'project':
      return `project:${source.projectId}`;
    default:
      return source.kind;
  }
}

function isRemote(source: Source): source is Extract<Source, { url: string }> {
  return source.kind === 'github' || source.kind === 'ado' || source.kind === 'other-git';
}

function actionLabel(source: Source, methodId: string): string {
  if (isRemote(source)) return getCloneMethod(methodId)?.interactive ? 'Run template' : 'Clone';
  if (source.kind === 'new-folder') return 'Create';
  if (source.kind === 'project') return 'Open project';
  return 'Add project';
}

const BUSY_LABEL: Partial<Record<Source['kind'], string>> = {
  github: 'Cloning…',
  ado: 'Cloning…',
  'other-git': 'Cloning…',
  'new-folder': 'Creating…',
};

const METHOD_OPTIONS = CLONE_METHODS.map((m) => ({
  value: m.id,
  label: m.interactive ? `${m.label} template` : 'git clone',
}));

function basename(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() || p;
}

/** `~/x` for a folder under `home`; main expands it back. */
function tildify(p: string, home: string): string {
  return home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p;
}

function dirname(p: string): string {
  return p.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
}

function NewProjectBody({ onCreated }: { onCreated: (id: string) => void }) {
  const close = useModalClose();
  const projectPaths = useProjects(useShallow((s) => s.projects.map((p) => p.path)));
  const [input, setInput] = useState('');
  const facts = usePathFacts(input);
  const source = classifySource(input, facts);
  // While a new path is being looked at, keep the last answer's options in
  // place (the action waits) rather than flashing them away.
  const shown = source.kind === 'checking' && facts ? classifySource(facts.input, facts) : source;
  const key = sourceKey(shown);

  const inferredName = 'name' in shown ? shown.name : '';
  const [name, setName] = useKeyedDraft(key, inferredName);
  const [initGit, setInitGit] = useKeyedDraft(key, shown.kind === 'new-folder');
  const [parentDir, setParentDir] = useState<string | null>(null);
  const home = window.electronAPI.getHomeDir();
  const cloneInto = parentDir ?? tildify(usualProjectsDir(projectPaths, home), home);
  const [methodId, setMethodId] = useState(CLONE_METHODS[0]!.id);
  const template = isRemote(shown) && !!getCloneMethod(methodId)?.interactive;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scaffoldSessionId, setScaffoldSessionId] = useState<string | null>(null);

  const canRun =
    source.kind !== 'checking' &&
    !scaffoldSessionId &&
    source.kind !== 'empty' &&
    source.kind !== 'invalid' &&
    (!isRemote(source) || !!cloneInto.trim());
  const locked = busy || !!scaffoldSessionId;

  const projectName = (folder: string) => name.trim() || basename(folder);

  /** Save a folder on disk as a project, with git as detected. */
  async function addFolder(path: string, displayName: string) {
    const git = await window.electronAPI.detectGit(path);
    const info = git.success ? git.data : null;
    const saved = await window.electronAPI.saveProject({
      name: displayName,
      path,
      isGitRepo: info?.isGitRepo ?? false,
      gitRemote: info?.remote ?? null,
      gitBranch: info?.branch ?? null,
    });
    if (!saved.success || !saved.data) throw new Error(saved.error || 'Couldn’t save the project');
    onCreated(saved.data.id);
    close();
  }

  async function run(s: Source) {
    switch (s.kind) {
      case 'project':
        onCreated(s.projectId);
        close();
        return;
      case 'local-repo':
        return addFolder(s.path, projectName(s.path));
      case 'local-folder': {
        if (initGit) {
          const resp = await window.electronAPI.gitInit(s.path);
          if (!resp.success) throw new Error(resp.error || 'git init failed');
        }
        return addFolder(s.path, projectName(s.path));
      }
      case 'new-folder': {
        const resp = await window.electronAPI.projectCreateEmpty({
          parentDir: dirname(s.path),
          name: basename(s.path),
          initGit,
        });
        if (!resp.success || !resp.data)
          throw new Error(resp.error || 'Couldn’t create the folder');
        return addFolder(resp.data.path, projectName(resp.data.path));
      }
      case 'github':
      case 'ado':
      case 'other-git': {
        if (template) {
          setScaffoldSessionId(`scaffold-${Date.now()}`);
          return;
        }
        const resp = await window.electronAPI.projectClone({ url: s.url, parentDir: cloneInto });
        if (!resp.success || !resp.data) throw new Error(resp.error || 'Clone failed');
        return addFolder(resp.data.path, projectName(resp.data.path));
      }
    }
  }

  async function submit() {
    if (busy || !canRun) return;
    setBusy(true);
    setError(null);
    try {
      await run(source);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader
        title="New project"
        hint="Type or paste a folder (one on this Mac, or a new one to create) or a git URL to clone."
      />
      <DialogBody>
        <div
          className="grid gap-3"
          onKeyDown={(e) => {
            // Enter in any of its text fields runs the action.
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <PathInput
            aria-label="Folder or git URL"
            placeholder="~/code/app, or https://github.com/owner/repo"
            value={input}
            onValueChange={(v) => {
              setInput(v);
              setError(null);
            }}
            disabled={locked}
            autoFocus
          />
          {shown.kind !== 'empty' && shown.kind !== 'checking' && (
            <div
              key={shown.kind}
              className="grid gap-1 transition duration-calm ease-settle starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none"
            >
              <SourceOptions
                source={shown}
                name={name}
                onName={setName}
                inferredName={inferredName}
                initGit={initGit}
                onInitGit={setInitGit}
                cloneInto={cloneInto}
                onCloneInto={setParentDir}
                methodId={methodId}
                onMethod={setMethodId}
                template={template}
                disabled={locked}
              />
            </div>
          )}
          {scaffoldSessionId && isRemote(shown) && (
            <ScaffoldTerminal
              sessionId={scaffoldSessionId}
              methodId={methodId}
              url={shown.url}
              parentDir={cloneInto}
              onExit={(exitCode, resultPath) => {
                setScaffoldSessionId(null);
                if (exitCode !== 0 || !resultPath) {
                  setError(
                    exitCode !== 0
                      ? `The template exited with code ${exitCode}`
                      : 'Couldn’t find the folder it made; add it by its path.',
                  );
                  return;
                }
                void addFolder(resultPath, basename(resultPath)).catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : String(e)),
                );
              }}
            />
          )}
        </div>
      </DialogBody>
      <DialogFooter
        status={error && <p className="text-xs break-words text-state-fail">{error}</p>}
      >
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={!canRun || busy}>
          {busy && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
          {busy ? (BUSY_LABEL[source.kind] ?? 'Adding…') : actionLabel(shown, methodId)}
        </Button>
      </DialogFooter>
    </>
  );
}

const NAME_HINT = 'How Dash shows the project; the folder keeps its own name.';

/** The options for what the input names: one row each, only the relevant ones. */
function SourceOptions({
  source,
  name,
  onName,
  inferredName,
  initGit,
  onInitGit,
  cloneInto,
  onCloneInto,
  methodId,
  onMethod,
  template,
  disabled,
}: {
  source: Source;
  name: string;
  onName: (v: string) => void;
  inferredName: string;
  initGit: boolean;
  onInitGit: (v: boolean) => void;
  cloneInto: string;
  onCloneInto: (v: string) => void;
  methodId: string;
  onMethod: (v: string) => void;
  template: boolean;
  disabled: boolean;
}) {
  if (source.kind === 'invalid') return <p className="type-caption">{source.reason}</p>;
  if (source.kind === 'project') {
    return <p className="type-caption">Already the project {source.name}.</p>;
  }

  const nameRow = (
    <SettingRow
      label="Name"
      hint={NAME_HINT}
      htmlFor="new-project-name"
      control={
        <Input
          id="new-project-name"
          className="w-72"
          value={name}
          placeholder={inferredName}
          onChange={(e) => onName(e.target.value)}
          disabled={disabled}
        />
      }
    />
  );
  const initGitRow = (hint: string) => (
    <SettingRow
      label="Initialise git"
      hint={hint}
      control={
        <Switch
          aria-label="Initialise git"
          checked={initGit}
          onCheckedChange={onInitGit}
          disabled={disabled}
        />
      }
    />
  );

  switch (source.kind) {
    case 'local-repo':
      return nameRow;
    case 'local-folder':
      return (
        <>
          {nameRow}
          {initGitRow(
            'Runs git init in the folder. Without git, tasks share the folder: no worktrees, no branches.',
          )}
        </>
      );
    case 'new-folder':
      return (
        <>
          {nameRow}
          {initGitRow('Creates the folder and runs git init in it, so tasks get worktrees.')}
        </>
      );
    default:
      return (
        <>
          {!template && nameRow}
          <SettingRow
            label="Clone into"
            hint="The folder the repository's folder goes in."
            control={
              <PathInput
                aria-label="Clone into"
                className="w-72"
                value={cloneInto}
                onValueChange={onCloneInto}
                disabled={disabled}
              />
            }
          />
          <SettingRow
            label="With"
            hint="git clone copies the repository. A cookiecutter or copier template asks its questions here, then makes a new project from it."
            control={
              <Select
                aria-label="With"
                className="w-72"
                value={methodId}
                onValueChange={onMethod}
                options={METHOD_OPTIONS}
              />
            }
          />
        </>
      );
  }
}
