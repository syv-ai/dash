import React, { useState } from 'react';
import { Loader2, FolderOpen } from 'lucide-react';
import { CLONE_METHODS } from '@shared/cloneMethods';
import { ScaffoldTerminal } from './ScaffoldTerminal';
import type { ProjectSource } from './SourceStep';

interface LocationStepProps {
  source: ProjectSource;
  /** Called when the source has produced a real folder on disk. */
  onResolved: (info: { path: string; name: string; isGitRepo: boolean }) => void;
}

const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg bg-transparent border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150';
const labelClass = 'block text-[12px] font-medium text-muted-foreground/70 mb-2';

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
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-muted-foreground/70">Choose an existing project folder.</p>
        <button
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
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border/60 hover:bg-accent/40 text-[13px] text-foreground self-start"
        >
          <FolderOpen size={15} strokeWidth={1.8} /> Choose folder…
        </button>
      </div>
    );
  }

  // ── Empty project ──
  if (source === 'empty') {
    const canCreate = parentDir && name.trim();
    return (
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelClass}>Project name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            autoFocus
          />
        </div>
        <div>
          <label className={labelClass}>Location (parent folder)</label>
          <div className="flex gap-2">
            <input
              value={parentDir}
              readOnly
              placeholder="Choose a location…"
              className={inputClass}
            />
            <button
              onClick={() => void pickFolder(setParentDir)}
              className="px-3 rounded-lg border border-border/60 text-[12px] text-foreground/80 hover:bg-accent/40"
            >
              Change…
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-foreground/90 cursor-pointer">
          <input
            type="checkbox"
            checked={initGit}
            onChange={(e) => setInitGit(e.target.checked)}
            className="accent-primary"
          />
          Initialize git repo
        </label>
        {error && <p className="text-[12px] text-destructive">{error}</p>}
        <button
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
          className="self-start flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 transition-all"
        >
          {busy && <Loader2 size={13} className="animate-spin" strokeWidth={2} />}
          Create directory
        </button>
      </div>
    );
  }

  // ── Clone / template ──
  const canRun = !!parentDir && !!url.trim();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className={labelClass}>Source URL</label>
        <div className="flex gap-2">
          <select
            value={methodId}
            onChange={(e) => setMethodId(e.target.value)}
            className="px-2 rounded-lg bg-transparent border border-input/60 text-foreground text-[13px]"
          >
            {CLONE_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/user/repo.git"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>Location (parent folder)</label>
        <div className="flex gap-2">
          <input
            value={parentDir}
            readOnly
            placeholder="Choose a location…  (e.g. ~/Dash)"
            className={inputClass}
          />
          <button
            onClick={() => void pickFolder(setParentDir)}
            className="px-3 rounded-lg border border-border/60 text-[12px] text-foreground/80 hover:bg-accent/40"
          >
            Change…
          </button>
        </div>
      </div>
      {error && <p className="text-[12px] text-destructive">{error}</p>}

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
        <button
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
          className="self-start flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 transition-all"
        >
          {busy && <Loader2 size={13} className="animate-spin" strokeWidth={2} />}
          {method.interactive ? 'Run generator' : 'Clone'}
        </button>
      )}
    </div>
  );
}
