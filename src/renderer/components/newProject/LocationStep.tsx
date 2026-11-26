import React, { useState } from 'react';
import { Loader2, FolderOpen } from 'lucide-react';
import { CLONE_METHODS } from '@shared/cloneMethods';
import { ScaffoldTerminal } from './ScaffoldTerminal';
import type { ProjectSource } from './SourceStep';
import { Button } from '../ui/Button';
import { CheckboxField } from '../ui/CheckboxField';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

interface LocationStepProps {
  source: ProjectSource;
  /** Called when the source has produced a real folder on disk. */
  onResolved: (info: { path: string; name: string; isGitRepo: boolean }) => void;
}

async function detectAndResolve(
  path: string,
  name: string,
  onResolved: LocationStepProps['onResolved'],
) {
  const gitResp = await window.electronAPI.detectGit(path);
  const isGitRepo = gitResp.success ? (gitResp.data?.isGitRepo ?? false) : false;
  onResolved({ path, name, isGitRepo });
}

export function LocationStep({ source, onResolved }: LocationStepProps) {
  const [parentDir, setParentDir] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [methodId, setMethodId] = useState(CLONE_METHODS[0]!.id);
  const [initGit, setInitGit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scaffoldSessionId, setScaffoldSessionId] = useState<string | null>(null);

  const method = CLONE_METHODS.find((m) => m.id === methodId)!;

  async function pickFolder(setter: (v: string) => void) {
    const resp = await window.electronAPI.showOpenDialog();
    if (resp.success && resp.data && resp.data.length > 0) setter(resp.data[0]!);
  }

  // ── Local folder: native picker resolves immediately ──
  if (source === 'local') {
    return (
      <div className="grid justify-items-start gap-3">
        <p className="type-body">Choose the project&rsquo;s folder.</p>
        <Button
          variant="secondary"
          onClick={() =>
            void (async () => {
              const resp = await window.electronAPI.showOpenDialog();
              if (resp.success && resp.data && resp.data.length > 0) {
                const folder = resp.data[0]!;
                await detectAndResolve(
                  folder,
                  folder.split(/[\\/]/).pop() || 'project',
                  onResolved,
                );
              }
            })()
          }
        >
          <FolderOpen size={14} strokeWidth={1.8} /> Choose folder…
        </Button>
      </div>
    );
  }

  // ── Empty project ──
  if (source === 'empty') {
    const canCreate = parentDir && name.trim();
    return (
      <div className="grid justify-items-start gap-4">
        <Field label="Name" className="w-full">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <ParentFolderField value={parentDir} onPick={() => void pickFolder(setParentDir)} />
        <CheckboxField
          checked={initGit}
          onChange={setInitGit}
          label="Initialize a git repository"
        />
        {error && <p className="text-xs text-state-fail">{error}</p>}
        <Button
          variant="secondary"
          disabled={!canCreate || busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              setError(null);
              const resp = await window.electronAPI.projectCreateEmpty({
                parentDir,
                name: name.trim(),
                initGit,
              });
              setBusy(false);
              if (!resp.success || !resp.data) {
                setError(resp.error || 'Failed to create project');
                return;
              }
              await detectAndResolve(resp.data.path, resp.data.name, onResolved);
            })()
          }
        >
          {busy && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
          Create folder
        </Button>
      </div>
    );
  }

  // ── Clone / template ──
  const canRun = !!parentDir && !!url.trim();
  return (
    <div className="grid justify-items-start gap-4">
      <Field label="Source" as="div" className="w-full">
        <div className="flex gap-2">
          <Select
            aria-label="Source type"
            className="w-40 shrink-0"
            value={methodId}
            onValueChange={setMethodId}
            options={CLONE_METHODS.map((m) => ({ value: m.id, label: m.label }))}
          />
          <Input
            aria-label="URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/user/repo.git"
          />
        </div>
      </Field>
      <ParentFolderField value={parentDir} onPick={() => void pickFolder(setParentDir)} />
      {error && <p className="text-xs text-state-fail">{error}</p>}

      {scaffoldSessionId && (
        <ScaffoldTerminal
          sessionId={scaffoldSessionId}
          methodId={methodId}
          url={url.trim()}
          parentDir={parentDir}
          onExit={(exitCode, resultPath) => {
            setScaffoldSessionId(null);
            if (exitCode !== 0 || !resultPath) {
              setError(
                exitCode !== 0
                  ? `Generator exited with code ${exitCode}`
                  : 'Could not detect the created folder — pick it manually.',
              );
              return;
            }
            void detectAndResolve(
              resultPath,
              resultPath.split(/[\\/]/).pop() || 'project',
              onResolved,
            );
          }}
        />
      )}

      {!scaffoldSessionId && (
        <Button
          variant="secondary"
          disabled={!canRun || busy}
          onClick={() =>
            void (async () => {
              setError(null);
              if (method.interactive) {
                setScaffoldSessionId(`scaffold-${Date.now()}`);
                return;
              }
              setBusy(true);
              const resp = await window.electronAPI.projectClone({ url: url.trim(), parentDir });
              setBusy(false);
              if (!resp.success || !resp.data) {
                setError(resp.error || 'Clone failed');
                return;
              }
              await detectAndResolve(resp.data.path, resp.data.name, onResolved);
            })()
          }
        >
          {busy && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
          {method.interactive ? 'Run generator' : 'Clone'}
        </Button>
      )}
    </div>
  );
}

/** Where the new folder goes: read-only, set through the folder picker. */
function ParentFolderField({ value, onPick }: { value: string; onPick: () => void }) {
  return (
    <Field label="Parent folder" as="div" className="w-full">
      <div className="flex gap-2">
        <Input aria-label="Parent folder" value={value} readOnly placeholder="Choose a folder…" />
        <Button variant="secondary" onClick={onPick}>
          <FolderOpen size={14} strokeWidth={1.8} />
          Choose…
        </Button>
      </div>
    </Field>
  );
}
