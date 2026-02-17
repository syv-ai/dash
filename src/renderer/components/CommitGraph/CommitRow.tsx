import React from 'react';
import { GitBranch, SquareTerminal, FolderGit2, Tag } from 'lucide-react';
import type { GraphCommit, CommitRef } from '../../../shared/types';
import type { TaskBranchInfo } from './CommitGraphModal';
import { getLaneColor } from './graphColors';
import { ROW_HEIGHT } from './graphLayout';

interface CommitRowProps {
  graphCommit: GraphCommit;
  selected: boolean;
  taskBranches: Map<string, TaskBranchInfo>;
  refColors: Map<string, number>;
  rowIndex?: number;
  githubSlug?: string | null;
  onSelectTask: (taskId: string) => void;
  onClick: () => void;
}

function BadgeIcon({ commitRef, taskInfo }: { commitRef: CommitRef; taskInfo?: TaskBranchInfo }) {
  const size = 9;
  const sw = 2;
  if (taskInfo?.useWorktree) return <FolderGit2 size={size} strokeWidth={sw} className="flex-shrink-0" />;
  if (taskInfo) return <SquareTerminal size={size} strokeWidth={sw} className="flex-shrink-0" />;
  if (commitRef.type === 'tag') return <Tag size={size} strokeWidth={sw} className="flex-shrink-0" />;
  return <GitBranch size={size} strokeWidth={sw} className="flex-shrink-0" />;
}

function RefBadge({
  commitRef,
  color,
  taskInfo,
  onClickTask,
}: {
  commitRef: CommitRef;
  color?: string;
  taskInfo?: TaskBranchInfo;
  onClickTask?: (taskId: string) => void;
}) {
  const label = taskInfo ? taskInfo.name : commitRef.name;

  let title: string;
  if (taskInfo) {
    title = `${taskInfo.useWorktree ? 'Worktree' : 'Task'}: ${taskInfo.name}\nBranch: ${commitRef.name}\nClick to open task`;
  } else if (commitRef.type === 'tag') {
    title = `Tag: ${commitRef.name}`;
  } else if (commitRef.type === 'remote') {
    title = `Remote branch: ${commitRef.name}`;
  } else if (commitRef.type === 'head') {
    title = `Branch: ${commitRef.name} (HEAD)`;
  } else {
    title = `Branch: ${commitRef.name}`;
  }
  const clickable = taskInfo && onClickTask;

  const content = (
    <>
      <BadgeIcon commitRef={commitRef} taskInfo={taskInfo} />
      {label}
    </>
  );

  const badgeClass = `inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold mr-1.5 leading-none ${clickable ? 'cursor-pointer hover:brightness-125' : ''}`;

  if (color) {
    return (
      <span
        className={badgeClass}
        style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`, color }}
        title={title}
        onClick={clickable ? (e) => { e.stopPropagation(); onClickTask(taskInfo.id); } : undefined}
      >
        {content}
      </span>
    );
  }

  return (
    <span
      className={`${badgeClass} bg-accent/80 text-foreground`}
      title={title}
      onClick={clickable ? (e) => { e.stopPropagation(); onClickTask(taskInfo.id); } : undefined}
    >
      {content}
    </span>
  );
}

function formatRelativeDate(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function GithubLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={`${className} hover:underline`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        window.electronAPI.openExternal(href);
      }}
      title={href}
    >
      {children}
    </a>
  );
}

export function CommitRow({ graphCommit, selected, taskBranches, refColors, rowIndex = 0, githubSlug, onSelectTask, onClick }: CommitRowProps) {
  const { commit } = graphCommit;
  const staggerDelay = rowIndex < 30 ? `${rowIndex * 12}ms` : '0ms';

  const commitUrl = githubSlug ? `https://github.com/${githubSlug}/commit/${commit.hash}` : null;
  const authorUrl = githubSlug ? `https://github.com/${githubSlug}/commits?author=${encodeURIComponent(commit.authorName)}` : null;

  return (
    <div
      className={`flex items-center gap-2 px-3 cursor-pointer transition-colors duration-75 ${
        selected ? 'bg-primary/10' : 'hover:bg-accent/50'
      } ${rowIndex < 30 ? 'animate-commit-row' : ''}`}
      style={{ height: ROW_HEIGHT, animationDelay: staggerDelay }}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {/* Ref badges — hide remote refs when a matching local branch exists */}
        {commit.refs.length > 0 && (() => {
          const localNames = new Set(
            commit.refs.filter((r) => r.type === 'local' || r.type === 'head').map((r) => r.name),
          );
          const filtered = commit.refs.filter(
            (r) => r.type !== 'remote' || !localNames.has(r.name.replace(/^[^/]+\//, '')),
          );
          return filtered.length > 0 ? (
            <div className="flex items-center flex-shrink-0">
              {filtered.map((r) => {
                const colorIdx = refColors.get(r.name);
                const task = taskBranches.get(r.name);
                return (
                  <RefBadge
                    key={r.name}
                    commitRef={r}
                    color={colorIdx !== undefined ? getLaneColor(colorIdx) : undefined}
                    taskInfo={task}
                    onClickTask={onSelectTask}
                  />
                );
              })}
            </div>
          ) : null;
        })()}

        {/* Subject */}
        <span className="truncate text-[12px] text-foreground">
          {commit.subject}
        </span>
      </div>

      {/* Author */}
      {authorUrl ? (
        <GithubLink href={authorUrl} className="text-[10px] text-muted-foreground/70 flex-shrink-0 truncate max-w-[120px]">
          {commit.authorName}
        </GithubLink>
      ) : (
        <span className="text-[10px] text-muted-foreground/70 flex-shrink-0 truncate max-w-[120px]">
          {commit.authorName}
        </span>
      )}

      {/* Hash */}
      {commitUrl ? (
        <GithubLink href={commitUrl} className="text-[10px] font-mono text-muted-foreground flex-shrink-0 tabular-nums">
          {commit.shortHash}
        </GithubLink>
      ) : (
        <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0 tabular-nums">
          {commit.shortHash}
        </span>
      )}

      {/* Relative date */}
      <span className="text-[10px] text-muted-foreground/70 flex-shrink-0 w-14 text-right tabular-nums">
        {formatRelativeDate(commit.authorDate)}
      </span>
    </div>
  );
}
