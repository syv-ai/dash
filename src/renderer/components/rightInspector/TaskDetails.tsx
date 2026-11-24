import { useEffect, useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { ContextUsage, Task } from '../../../shared/types';
import { linkedItemUrl } from '../../../shared/urls';
import { formatRelativeTime } from '../../../shared/relativeTime';
import { useGit } from '../../stores/gitStore';
import { useRuntime } from '../../stores/runtimeStore';
import { selectTaskById, useProjects } from '../../stores/projectsStore';
import { useSettings } from '../../stores/settingsStore';
import { Button } from '../ui/Button';
import { DetailItem, DetailList, DetailSection } from '../ui/DetailList';
import { Expandable } from '../ui/Expandable';
import { Markdown } from '../ui/Markdown';
import { PrRow } from '../ui/PrBadge';
import { SyncStatus } from '../changes/SyncStatus';
import { taskDetailSections, type DetailRow } from './taskDetailRows';

interface TaskDetailsProps {
  task: Task;
  /** The live model from the session's status line, if it has reported. */
  modelName: string | null;
  contextUsage?: ContextUsage;
  onEditSettings: () => void;
}

interface LastCommit {
  shortHash: string;
  subject: string;
  /** Epoch seconds. */
  authorDate: number;
}

/** The branch's newest commit, refetched when HEAD's status changes. */
function useLastCommit(cwd: string, statusKey: unknown): LastCommit | null {
  const [commit, setCommit] = useState<LastCommit | null>(null);
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

function Rows({ rows }: { rows: DetailRow[] }) {
  return (
    <DetailList>
      {rows.map((r) => (
        <DetailItem
          key={r.label}
          label={r.label}
          title={r.title ?? r.value}
          copy={r.copy ? r.value : undefined}
        >
          {r.value}
        </DetailItem>
      ))}
    </DetailList>
  );
}

/**
 * The Details tab: everything about the task in calm sections, each shown
 * only when it has something to say: the task, its session, usage, git,
 * pull requests, linked items, the context prompt and its settings (read
 * only; "Edit" opens the task settings).
 */
export function TaskDetails({ task, modelName, contextUsage, onEditSettings }: TaskDetailsProps) {
  const project = useProjects((s) => s.projects.find((p) => p.id === task.projectId) ?? null);
  const parentName = useProjects((s) =>
    task.parentTaskId ? (selectTaskById(s, task.parentTaskId)?.name ?? null) : null,
  );
  const showCost = useSettings((s) => s.showTaskCost);
  const activity = useRuntime((s) => s.taskActivity[task.id]?.state ?? null);
  const gitStatus = useGit((s) => s.gitStatus);
  const prs = useGit((s) => s.branchPrsByTask[task.id]);
  const lastCommit = useLastCommit(task.path, gitStatus);

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
      }),
    [task, project?.name, parentName, modelName, contextUsage, showCost, activity],
  );

  const branch = gitStatus?.branch || task.branch;
  const linked = task.linkedItems ?? [];
  const scripts = [
    { label: 'Setup', script: task.setupScript },
    { label: 'Teardown', script: task.teardownScript },
  ].filter((s): s is { label: string; script: string } => !!s.script?.trim());

  return (
    <div className="scrollbar-gutter-stable min-h-0 flex-1 overflow-y-auto pb-3 animate-fade-in">
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
              {branch}
            </DetailItem>
          )}
          {gitStatus && (
            <DetailItem label="Upstream">
              <SyncStatus status={gitStatus} />
            </DetailItem>
          )}
          {lastCommit && (
            <DetailItem
              label="Last commit"
              title={`${lastCommit.shortHash} ${lastCommit.subject}`}
              copy={lastCommit.shortHash}
            >
              {lastCommit.subject}
              <span className="ml-1.5 tabular-nums text-ink-3">
                {lastCommit.shortHash} ·{' '}
                {formatRelativeTime(lastCommit.authorDate, Date.now() / 1000)}
              </span>
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
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-colors hover:text-ink-2 hover:underline"
                    >
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </DetailItem>
              );
            })}
          </DetailList>
        </DetailSection>
      )}

      {task.contextPrompt?.trim() && (
        <DetailSection title="Prompt">
          <Expandable label="Context prompt">
            <div className="text-sm text-ink-2">
              <Markdown text={task.contextPrompt} />
            </div>
          </Expandable>
        </DetailSection>
      )}

      <DetailSection
        title="Settings"
        action={
          <Button variant="ghost" size="sm" onClick={onEditSettings}>
            <Settings2 size={14} strokeWidth={1.8} />
            Edit task settings
          </Button>
        }
      >
        {scripts.length > 0 ? (
          <div className="grid gap-2">
            {scripts.map(({ label, script }) => (
              <div key={label} className="grid gap-1">
                <span className="text-sm text-ink-3">{label} script</span>
                {/* Scripts are code: the one place here in mono. */}
                <pre className="overflow-x-auto rounded-md bg-hover px-2 py-1.5 font-mono text-xs text-ink-2">
                  {script}
                </pre>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-3">No setup or teardown scripts for this task.</p>
        )}
      </DetailSection>
    </div>
  );
}
