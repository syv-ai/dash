import { useEffect, useMemo, useState } from 'react';
import type { ContextUsage, EditorCommitListItem, GitStatus, Task } from '../../../shared/types';
import { forgeBranchUrl, linkedItemUrl, parseForgeRepo } from '../../../shared/urls';
import { formatRelativeTime } from '../../../shared/relativeTime';
import { useGit } from '../../stores/gitStore';
import { useRuntime } from '../../stores/runtimeStore';
import { selectTaskById, useProjects } from '../../stores/projectsStore';
import { useSettings } from '../../stores/settingsStore';
import { DetailItem, DetailList, DetailSection } from '../ui/DetailList';
import { Markdown } from '../ui/Markdown';
import { PrRow } from '../ui/PrBadge';
import { TextLink } from '../ui/TextLink';
import { SyncStatus, type SyncLinks } from '../changes/SyncStatus';
import { CommitHash, CommitHoverCard } from '../commits/CommitHoverCard';
import { useCommitLinks } from '../commits/useCommitLinks';
import { useSectionOpen } from '../../lib/useSectionOpen';
import { taskDetailSections, type DetailRow } from './taskDetailRows';

interface TaskDetailsProps {
  task: Task;
  /** The live model from the session's status line, if it has reported. */
  modelName: string | null;
  contextUsage?: ContextUsage;
  onEditSettings: () => void;
  /** Open a commit in the sidebar's History (selected, its files unfolded). */
  onOpenCommit: (hash: string) => void;
  /** Where the Sync row's ahead / behind counts lead. */
  syncLinks: SyncLinks;
}

/** The branch's newest commit, refetched when HEAD's status changes. */
function useLastCommit(cwd: string, statusKey: unknown): EditorCommitListItem | null {
  const [commit, setCommit] = useState<EditorCommitListItem | null>(null);
  useEffect(() => {
    let live = true;
    void window.electronAPI.editorListCommits({ cwd, limit: 1 }).then((r) => {
      if (live) setCommit(r.success && r.data?.[0] ? r.data[0] : null);
    });
    return () => {
      live = false;
    };
  }, [cwd, statusKey]);
  return commit;
}

/**
 * When the task's conversation last changed, re-read whenever its session's
 * state moves, with a clock that ticks each half minute so "4 min ago" ages.
 */
function useLastActive(taskId: string, activity: unknown): { ms: number | null; now: number } {
  const [ms, setMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void window.electronAPI.getTaskLastActive(taskId).then((r) => {
      if (live) setMs(r.success ? (r.data ?? null) : null);
    });
    setNow(Date.now());
    return () => {
      live = false;
    };
  }, [taskId, activity]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return { ms, now };
}

function Rows({ rows }: { rows: DetailRow[] }) {
  return (
    <DetailList>
      {rows.map((r) => (
        <DetailItem key={r.label} label={r.label} title={r.title ?? r.value} copy={r.copy}>
          {r.value}
        </DetailItem>
      ))}
    </DetailList>
  );
}

/**
 * The Details tab: everything about the task in calm sections, each shown
 * only when it has something to say: the task, its session, usage, git,
 * pull requests, linked items and the context prompt (read only; the line
 * on top opens the task settings).
 */
export function TaskDetails({
  task,
  modelName,
  contextUsage,
  onEditSettings,
  onOpenCommit,
  syncLinks,
}: TaskDetailsProps) {
  const project = useProjects((s) => s.projects.find((p) => p.id === task.projectId) ?? null);
  const parentName = useProjects((s) =>
    task.parentTaskId ? (selectTaskById(s, task.parentTaskId)?.name ?? null) : null,
  );
  const showCost = useSettings((s) => s.showTaskCost);
  const activity = useRuntime((s) => s.taskActivity[task.id]?.state ?? null);
  const gitStatus = useGit((s) => s.gitStatus);
  const prs = useGit((s) => s.branchPrsByTask[task.id]);
  const lastCommit = useLastCommit(task.path, gitStatus);
  const { ms: lastActiveMs, now } = useLastActive(task.id, activity);

  const sections = useMemo(
    () =>
      taskDetailSections({
        task,
        projectName: project?.name ?? null,
        parentTaskName: parentName,
        liveModel: modelName,
        contextPercent:
          contextUsage && contextUsage.percentage > 0 ? contextUsage.percentage : null,
        showCost,
        activity,
        lastActiveMs,
        homeDir: window.electronAPI.getHomeDir(),
        now,
      }),
    [
      task,
      project?.name,
      parentName,
      modelName,
      contextUsage,
      showCost,
      activity,
      lastActiveMs,
      now,
    ],
  );

  const branch = gitStatus?.branch || task.branch;
  const linked = task.linkedItems ?? [];

  return (
    <div className="scrollbar-gutter-stable min-h-0 flex-1 overflow-y-auto pb-3 animate-fade-in">
      <p className="type-caption px-2.5 pt-3">
        Edit task settings <TextLink onClick={onEditSettings}>here</TextLink>
      </p>

      <DetailSection title="Task">
        <Rows rows={sections.task} />
      </DetailSection>

      <DetailSection title="Session">
        <Rows rows={sections.session} />
      </DetailSection>

      {sections.usage.length > 0 && (
        <DetailSection title="Usage">
          <Rows rows={sections.usage} />
        </DetailSection>
      )}

      <DetailSection title="Git">
        <DetailList>
          {branch && (
            <DetailItem label="Branch" copy={branch} title={branch}>
              <BranchLink branch={branch} status={gitStatus} remote={project?.gitRemote ?? null} />
            </DetailItem>
          )}
          {gitStatus && (
            <UpstreamRows
              status={gitStatus}
              remote={project?.gitRemote ?? null}
              links={syncLinks}
            />
          )}
          {lastCommit && (
            <DetailItem label="Last commit" copy={lastCommit.shortHash}>
              <LastCommit commit={lastCommit} cwd={task.path} onOpen={onOpenCommit} />
            </DetailItem>
          )}
          {task.useWorktree && (
            <DetailItem label="Branch from">
              {task.branchCreatedByDash ? 'Created by Dash' : 'An existing branch'}
            </DetailItem>
          )}
        </DetailList>
      </DetailSection>

      {prs && prs.length > 0 && (
        <DetailSection title="Pull requests">
          <div className="-mx-1 grid">
            {prs.map((pr) => (
              <PrRow key={pr.number} pr={pr} taskId={task.id} />
            ))}
          </div>
        </DetailSection>
      )}

      {linked.length > 0 && (
        <DetailSection title="Linked items">
          <DetailList>
            {linked.map((item) => {
              const url = linkedItemUrl(item, project?.gitRemote ?? null);
              return (
                <DetailItem
                  key={`${item.provider}-${item.id}`}
                  label={<span className="tabular-nums">#{item.id}</span>}
                  title={item.title}
                >
                  {url ? <TextLink href={url}>{item.title}</TextLink> : item.title}
                </DetailItem>
              );
            })}
          </DetailList>
        </DetailSection>
      )}

      {task.contextPrompt?.trim() && <ContextPrompt text={task.contextPrompt} />}
    </div>
  );
}

/** The task's context prompt, a drawer folded until opened (kept for the
 *  session, like every drawer). */
function ContextPrompt({ text }: { text: string }) {
  const section = useSectionOpen('details.contextPrompt', false);
  return (
    <div className="pt-4">
      <DetailSection title="Context prompt" collapsible {...section}>
        <div className="text-sm text-ink-2">
          <Markdown text={text} />
        </div>
      </DetailSection>
    </div>
  );
}

/** The branch, linked to its page on the forge once it is pushed to origin
 *  (the project's remote is origin's). */
function BranchLink({
  branch,
  status,
  remote,
}: {
  branch: string;
  status: GitStatus | null;
  remote: string | null;
}) {
  const upstream = status?.hasUpstream ? status.upstream : null;
  const repo = upstream?.remote === 'origin' ? parseForgeRepo(remote) : null;
  if (!upstream || !repo) return <>{branch}</>;
  return (
    <TextLink href={forgeBranchUrl(repo, upstream.branch)} title={`Open ${branch} on the forge`}>
      {branch}
    </TextLink>
  );
}

/**
 * The branch the checkout tracks, `origin/feat/x` linked to its page on the
 * forge (only an `origin` branch: the project's remote is origin's), then
 * how far ahead and behind it the checkout is.
 */
function UpstreamRows({
  status,
  remote,
  links,
}: {
  status: GitStatus;
  remote: string | null;
  links: SyncLinks;
}) {
  const { upstream } = status;
  if (!status.hasUpstream || !upstream) {
    return <DetailItem label="Upstream">No upstream</DetailItem>;
  }
  const name = `${upstream.remote}/${upstream.branch}`;
  const repo = upstream.remote === 'origin' ? parseForgeRepo(remote) : null;
  return (
    <>
      <DetailItem label="Upstream" title={name} copy={name}>
        {repo ? (
          <TextLink
            href={forgeBranchUrl(repo, upstream.branch)}
            title={`Open ${name} on the forge`}
          >
            {name}
          </TextLink>
        ) : (
          name
        )}
      </DetailItem>
      <DetailItem label="Sync">
        <SyncStatus status={status} links={links} />
      </DetailItem>
    </>
  );
}

/**
 * The branch's newest commit: its subject (opens it in History; hovering
 * shows the shared commit card, body and all), then its hash, linked to the
 * forge once pushed, and its age. Links take the `link` colour (D191).
 */
function LastCommit({
  commit,
  cwd,
  onOpen,
}: {
  commit: EditorCommitListItem;
  cwd: string;
  onOpen: (hash: string) => void;
}) {
  const links = useCommitLinks(cwd, commit.hash, true);
  // The subject gives way to the hash and age, which always show.
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <CommitHoverCard
        commit={commit}
        cwd={cwd}
        side="left"
        trigger={(hover) => (
          <span {...hover} className="min-w-0 truncate">
            <TextLink onClick={() => onOpen(commit.hash)}>
              {commit.subject || '(no subject)'}
            </TextLink>
          </span>
        )}
      />
      <span className="type-caption shrink-0 tabular-nums">
        <CommitHash hash={commit.shortHash} url={links.commitUrl} /> ·{' '}
        {formatRelativeTime(commit.authorDate, Date.now() / 1000)}
      </span>
    </span>
  );
}
