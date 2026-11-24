import { useRef } from 'react';
import { FileDiff } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '../ui/EmptyState';
import { FileTreeView } from './FileTreeView';
import { VirtualFileList, VIRTUALIZE_THRESHOLD, type FileSection } from './VirtualFileList';
import { CommitRunView } from './CommitRunView';
import { SectionLabel } from './SectionLabel';
import { SyncStatus, type SyncLinks } from './SyncStatus';
import type { CommitRun } from './useCommitRun';
import type { CommitRunState } from './commitRunReducer';
import { useGit } from '../../stores/gitStore';
import type { FileChange } from '../../../shared/types';

interface FileChangesPanelProps {
  loading: boolean;
  /** The commit in flight (or just finished): shown instead of the files. */
  run: CommitRun;
  onViewDiff: (filePath: string, staged: boolean) => void;
  /** Where the empty view's ahead / behind counts lead. */
  syncLinks: SyncLinks;
}

/**
 * The task's working changes as staged and unstaged trees (a windowed list
 * past VIRTUALIZE_THRESHOLD files), or the commit run while one is shown.
 * With nothing changed, where the branch stands against its upstream.
 */
export function FileChangesPanel({ loading, run, onViewDiff, syncLinks }: FileChangesPanelProps) {
  const gitStatus = useGit((s) => s.gitStatus);
  const onStageFiles = useGit((s) => s.stageFiles);
  const onUnstageFiles = useGit((s) => s.unstageFiles);
  const onDiscardFiles = useGit((s) => s.discardFiles);
  const onAddToGitignore = useGit((s) => s.addToGitignore);
  const fileListRef = useRef<HTMLDivElement | null>(null);

  if (!gitStatus) {
    return <EmptyState title={loading ? 'Loading…' : 'No task selected'} />;
  }

  const runState = run.state;
  if (
    runState.status === 'running' ||
    runState.status === 'failed' ||
    runState.status === 'cancelled'
  ) {
    const unstaged = new Set(gitStatus.files.filter((f) => !f.staged).map((f) => f.path));
    const autoFixPaths = run.autoFixPaths(unstaged);
    return (
      <div className="flex min-h-0 flex-1 flex-col animate-fade-in">
        <CommitRunView
          state={runState as Exclude<CommitRunState, { status: 'idle' } | { status: 'success' }>}
          autoFixCount={autoFixPaths.length}
          onCancel={run.cancel}
          onBackToFiles={run.dismiss}
          onStageFixesAndRetry={() => {
            run.stageFixesAndRetry(autoFixPaths).catch((err: unknown) => {
              toast.error(err instanceof Error ? err.message : 'Retry failed');
            });
          }}
        />
      </div>
    );
  }

  const stagedFiles = gitStatus.files.filter((f) => f.staged);
  const unstagedFiles = gitStatus.files.filter((f) => !f.staged);
  const total = gitStatus.files.length;

  if (total === 0) {
    return (
      <EmptyState
        icon={<FileDiff size={14} strokeWidth={1.8} />}
        title="No changes"
        description={<SyncStatus status={gitStatus} links={syncLinks} />}
      />
    );
  }

  const common = {
    onDiscard: (f: FileChange) => void onDiscardFiles([f.path]),
    onDiscardMany: (paths: string[]) => void onDiscardFiles(paths),
    onAddToGitignore: (path: string) => void onAddToGitignore(path),
  };
  const sections: FileSection[] = [];
  if (stagedFiles.length > 0) {
    sections.push({
      id: 'staged',
      label: `Staged · ${stagedFiles.length}`,
      files: stagedFiles,
      onToggleFileStage: (f) => void onUnstageFiles([f.path]),
      onToggleFolderStage: (paths) => void onUnstageFiles(paths),
      onViewDiff: (f) => onViewDiff(f.path, true),
      ...common,
    });
  }
  if (unstagedFiles.length > 0) {
    sections.push({
      id: 'unstaged',
      label: `Unstaged · ${unstagedFiles.length}`,
      files: unstagedFiles,
      onToggleFileStage: (f) => void onStageFiles([f.path]),
      onToggleFolderStage: (paths) => void onStageFiles(paths),
      onViewDiff: (f) => onViewDiff(f.path, false),
      ...common,
    });
  }

  return (
    <div
      ref={fileListRef}
      className="scrollbar-gutter-stable min-h-0 flex-1 overflow-y-auto pb-2 animate-fade-in"
    >
      {total > VIRTUALIZE_THRESHOLD ? (
        <VirtualFileList sections={sections} filesVersion={gitStatus} scrollRef={fileListRef} />
      ) : (
        sections.map((section) => (
          <div key={section.id} className="flex flex-col">
            <SectionLabel>{section.label}</SectionLabel>
            <FileTreeView
              files={section.files}
              onToggleFileStage={section.onToggleFileStage}
              onToggleFolderStage={section.onToggleFolderStage}
              onViewDiff={section.onViewDiff}
              onDiscard={section.onDiscard}
              onDiscardMany={section.onDiscardMany}
              onAddToGitignore={section.onAddToGitignore}
            />
          </div>
        ))
      )}
    </div>
  );
}
