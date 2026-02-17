import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  CommitGraphData,
  CommitDetail as CommitDetailType,
} from '../../../shared/types';
import { GraphSvg } from './GraphSvg';
import { CommitRow } from './CommitRow';
import { CommitDetailPanel } from './CommitDetail';
import { ROW_HEIGHT } from './graphLayout';

import type { TaskBranchInfo } from './CommitGraphModal';

interface CommitGraphViewProps {
  projectPath: string;
  gitRemote: string | null;
  taskBranches: Map<string, TaskBranchInfo>;
  onSelectTask: (taskId: string) => void;
}

const PAGE_SIZE = 150;

/** Extract GitHub org/repo slug from a remote URL */
function getGithubSlug(remote: string | null): string | null {
  if (!remote) return null;
  const ssh = remote.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return ssh[1];
  const https = remote.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (https) return https[1];
  return null;
}

export function CommitGraphView({ projectPath, gitRemote, taskBranches, onSelectTask }: CommitGraphViewProps) {
  const [graphData, setGraphData] = useState<CommitGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [detail, setDetail] = useState<CommitDetailType | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailClosing, setDetailClosing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // taskBranches is already a Map, no need to transform
  const githubSlug = useMemo(() => getGithubSlug(gitRemote), [gitRemote]);

  const fetchGraph = useCallback(
    async (skip = 0) => {
      const res = await window.electronAPI.gitGetCommitGraph({
        cwd: projectPath,
        limit: PAGE_SIZE,
        skip,
      });
      return res.success ? res.data! : null;
    },
    [projectPath],
  );

  useEffect(() => {
    setLoading(true);
    setSelectedRow(null);
    setDetail(null);
    fetchGraph(0).then((data) => {
      setGraphData(data);
      setLoading(false);
    });
  }, [fetchGraph]);

  async function handleLoadMore() {
    if (!graphData || loadingMore) return;
    setLoadingMore(true);
    const moreData = await fetchGraph(graphData.commits.length);
    if (moreData && moreData.commits.length > 0) {
      setGraphData({
        commits: [...graphData.commits, ...moreData.commits],
        totalCount: moreData.totalCount,
        maxLanes: Math.max(graphData.maxLanes, moreData.maxLanes),
      });
    }
    setLoadingMore(false);
  }

  // Build a map from ref name → lane color index so badges match their graph lane
  // Must be before early returns to satisfy Rules of Hooks
  const refColors = useMemo(() => {
    const map = new Map<string, number>();
    if (!graphData) return map;
    for (const gc of graphData.commits) {
      for (const r of gc.commit.refs) {
        if (!map.has(r.name)) {
          map.set(r.name, gc.laneColor);
        }
      }
    }
    return map;
  }, [graphData]);

  function handleCloseDetail() {
    setDetailClosing(true);
  }

  function handleDetailClosed() {
    setSelectedRow(null);
    setDetail(null);
    setDetailClosing(false);
  }

  async function handleSelectCommit(row: number) {
    if (selectedRow === row) {
      handleCloseDetail();
      return;
    }
    setDetailClosing(false);
    setSelectedRow(row);
    setDetailLoading(true);
    const commit = graphData!.commits[row].commit;
    const res = await window.electronAPI.gitGetCommitDetail({
      cwd: projectPath,
      hash: commit.hash,
    });
    if (res.success && res.data) {
      setDetail(res.data);
    }
    setDetailLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-[13px] text-muted-foreground">Loading commit history...</span>
        </div>
      </div>
    );
  }

  if (!graphData || graphData.commits.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-[13px] text-muted-foreground">No commits found</span>
      </div>
    );
  }

  const hasMore = graphData.commits.length < graphData.totalCount;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Graph + commit list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-w-0">
        <div className="flex">
          {/* SVG graph column */}
          <div className="flex-shrink-0 sticky left-0 z-10 bg-card">
            <GraphSvg
              commits={graphData.commits}
              maxLanes={graphData.maxLanes}
              selectedRow={selectedRow}
            />
          </div>

          {/* Commit rows */}
          <div className="flex-1 min-w-0">
            {graphData.commits.map((gc, row) => (
              <CommitRow
                key={gc.commit.hash}
                graphCommit={gc}
                selected={selectedRow === row}
                taskBranches={taskBranches}
                onSelectTask={onSelectTask}
                refColors={refColors}
                rowIndex={row}
                githubSlug={githubSlug}
                onClick={() => handleSelectCommit(row)}
              />
            ))}

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center py-3" style={{ height: ROW_HEIGHT + 16 }}>
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-4 py-1.5 rounded-md text-[11px] font-medium bg-accent hover:bg-accent/80 text-foreground/80 hover:text-foreground transition-colors disabled:opacity-40"
                >
                  {loadingMore ? 'Loading...' : `Load more (${graphData.totalCount - graphData.commits.length} remaining)`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {selectedRow !== null && (
        <CommitDetailPanel
          detail={detail}
          loading={detailLoading}
          open={!detailClosing}
          githubSlug={githubSlug}
          onClose={handleCloseDetail}
          onClosed={handleDetailClosed}
        />
      )}
    </div>
  );
}
