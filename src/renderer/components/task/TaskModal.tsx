import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowDown, FolderGit2, GitBranch, Loader2 } from 'lucide-react';
import { SearchableMultiSelect } from '../ui/SearchableMultiSelect';
import type {
  BranchInfo,
  CreateTaskOptions,
  PullRequest,
  GithubIssue,
  AzureDevOpsWorkItem,
  LinkedItem,
  PermissionMode,
  TaskModel,
} from '../../../shared/types';
import { forgeCapabilitiesFor } from '../../../shared/forgeCapabilities';
import { branchSlug } from '../../../shared/slug';
import { linkedAdoWorkItem, linkedGithubIssue } from '../../../shared/taskContext';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Field, SettingRow } from '../ui/Field';
import { Input } from '../ui/Input';
import { useModalClose } from '../ui/Modal';
import { Notice } from '../ui/Notice';
import { SuggestionMenu } from '../ui/SuggestionMenu';
import { Textarea } from '../ui/Textarea';
import { PermissionModePicker } from './PermissionModePicker';
import { useSettings } from '../../stores/settingsStore';
import { ModelPicker } from './ModelPicker';
import { getTaskCreatability } from './taskModalCreatability';
import { Expandable } from '../ui/Expandable';
import { isDirectCheckout } from './directCheckout';
import { Segmented } from '../ui/Segmented';
import { SwitchField } from '../ui/SwitchField';
import { useControlInfo } from '../../hooks/useControlInfo';
import { BranchPrPicker } from './BranchPrPicker';
import { findBranchHolder, describeBranchHolder } from './branchHolder';
import { useProjects } from '../../stores/projectsStore';
import { useSlashCommands } from './useSlashCommands';
import { useBypassAvailability } from './changeSessionSetting';
import { ExtraArgsField } from './ExtraArgsField';
import { validateExtraArgs } from '../../../shared/extraArgs';
import { addDirProblem, normalizeAddDirs } from '../../../shared/addDirs';
import { AddDirsField } from './AddDirsField';
import { EffortPicker } from './EffortPicker';
import { AgentPicker } from './AgentPicker';
import type { TaskEffort } from '../../../shared/effort';

/** A task started from a PR (the project page's Pull requests): the modal
 *  opens with the PR's head picked, and `review` enters review mode on the
 *  PR once the task is made. */
export interface TaskFromPr {
  pr: PullRequest;
  review: boolean;
}

// Lives in shared/types (main's TaskService takes it too); re-exported so
// imports don't churn.
export type { CreateTaskOptions };

/** Project-level prefill for the New Task fields, loaded from .dash/config.json.
 *  Prefill only — sets each field's default value; the user can still change it. */
export interface TaskModalDefaults {
  baseRef?: string;
  permissionMode?: PermissionMode;
  useWorktree?: boolean;
  contextPrompt?: string;
  dashAccess?: boolean;
  /** From `.dash/config.local.json` only. */
  extraArgs?: string;
  /** From `.dash/config.local.json` only. */
  addDirs?: string[];
}

interface TaskModalProps {
  projectPath: string;
  /** The PR the task starts from, its head picked as the modal opens. */
  fromPr?: PullRequest | null;
  projectId?: string;
  isGitRepo: boolean;
  gitRemote: string | null;
  existingNonWorktreeTask?: { id: string; name: string } | null;
  /** Pre-resolved at App-level so the issue picker + branch banner render at
   *  their final size on first paint, avoiding a visible "settle" as the modal grows. */
  ghAvailable: boolean;
  adoConfigured: boolean;
  initialBranches?: BranchInfo[];
  taskDefaults?: TaskModalDefaults | null;
  onClose: () => void;
  onCreate: (options: CreateTaskOptions) => Promise<boolean>;
  onGitInit?: () => void;
}

export function TaskModal(props: TaskModalProps) {
  return (
    // Visible overflow: the issue picker's list drops below the card.
    <Dialog size="xl" onClose={props.onClose} overflow="visible">
      <TaskModalBody
        projectPath={props.projectPath}
        fromPr={props.fromPr}
        projectId={props.projectId}
        isGitRepo={props.isGitRepo}
        gitRemote={props.gitRemote}
        existingNonWorktreeTask={props.existingNonWorktreeTask}
        ghAvailable={props.ghAvailable}
        adoConfigured={props.adoConfigured}
        initialBranches={props.initialBranches}
        taskDefaults={props.taskDefaults}
        onCreate={props.onCreate}
        onGitInit={props.onGitInit}
      />
    </Dialog>
  );
}

interface TaskModalBodyProps {
  projectPath: string;
  /** The PR the task starts from, its head picked as the modal opens. */
  fromPr?: PullRequest | null;
  projectId?: string;
  isGitRepo: boolean;
  gitRemote: string | null;
  existingNonWorktreeTask?: { id: string; name: string } | null;
  ghAvailable: boolean;
  adoConfigured: boolean;
  initialBranches?: BranchInfo[];
  taskDefaults?: TaskModalDefaults | null;
  onCreate: (options: CreateTaskOptions) => Promise<boolean>;
  onGitInit?: () => void;
}

function GithubIssueRow({ issue }: { issue: GithubIssue }) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="type-caption shrink-0 tabular-nums">#{issue.number}</span>
        <span className="type-body truncate">{issue.title}</span>
      </div>
      {issue.labels.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {issue.labels.slice(0, 3).map((label) => (
            <Badge key={label} size="sm">
              {label}
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

function AdoWorkItemRow({ item }: { item: AzureDevOpsWorkItem }) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="type-caption shrink-0 tabular-nums">#{item.id}</span>
        <span className="type-body truncate">{item.title}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {[item.type, item.state, ...(item.tags?.slice(0, 2) ?? [])].map((tag) => (
          <Badge key={tag} size="sm">
            {tag}
          </Badge>
        ))}
      </div>
    </>
  );
}

function TaskModalBody({
  projectPath,
  fromPr,
  projectId,
  isGitRepo,
  gitRemote,
  existingNonWorktreeTask,
  ghAvailable,
  adoConfigured,
  initialBranches,
  taskDefaults,
  onCreate,
  onGitInit,
}: TaskModalBodyProps) {
  const close = useModalClose();
  const [name, setName] = useState('');
  const [gitReady, setGitReady] = useState(isGitRepo);
  const worktreeForced = !!existingNonWorktreeTask;
  const [useWorktree, setUseWorktree] = useState(
    taskDefaults?.useWorktree ?? (isGitRepo || worktreeForced),
  );
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    () => taskDefaults?.permissionMode ?? useSettings.getState().newTaskPermissionMode,
  );
  const [model, setModel] = useState<TaskModel>(() => useSettings.getState().newTaskModel);
  const [effort, setEffort] = useState<TaskEffort | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [contextPrompt, setContextPrompt] = useState(taskDefaults?.contextPrompt ?? '');
  const contextField = useRef<HTMLTextAreaElement>(null);
  const slash = useSlashCommands({
    field: contextField,
    projectPath,
    text: contextPrompt,
    setText: setContextPrompt,
  });
  const [dashAccess, setDashAccess] = useState(taskDefaults?.dashAccess ?? false);
  const [extraArgs, setExtraArgs] = useState(taskDefaults?.extraArgs ?? '');
  const extraArgsOk = validateExtraArgs(extraArgs).ok;
  const [addDirs, setAddDirs] = useState<string[]>(taskDefaults?.addDirs ?? []);
  const addDirsOk = addDirs.every((d) => !addDirProblem(d));
  // The project's folder decides it for a task not made yet: a worktree reads
  // the same project files, and its local file sits at this root.
  const bypass = useBypassAvailability(projectPath);
  const controlSupported = useControlInfo()?.supported ?? false;
  const [pushRemote, setPushRemote] = useState(true);
  const [gitInitLoading, setGitInitLoading] = useState(false);
  const [createNewBranch, setCreateNewBranch] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  // When the chosen branch is behind its upstream, whether to fast-forward it to
  // remote before creating the task. Reset whenever the selected branch changes.
  const [updateFromRemote, setUpdateFromRemote] = useState(false);

  // Seeded from App-level cache when available so the status banner renders
  // at its final height on first paint.
  const [branches, setBranches] = useState<BranchInfo[]>(initialBranches ?? []);
  const [branchLoading, setBranchLoading] = useState(false);
  // True once a branch fetch has resolved (or branches were preloaded), so an
  // empty branch list can be trusted to mean "repo has no commits yet".
  const [branchFetchDone, setBranchFetchDone] = useState((initialBranches?.length ?? 0) > 0);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<BranchInfo | null>(() => {
    const list = initialBranches ?? [];
    if (taskDefaults?.baseRef) {
      const match = list.find(
        (b) => b.ref === taskDefaults.baseRef || b.name === taskDefaults.baseRef,
      );
      if (match) return match;
    }
    return list[0] ?? null;
  });
  // Issue/work item selection: only what the remote's forge links tasks to.
  const linkedItems = forgeCapabilitiesFor(gitRemote)?.linkedItems;
  const [selectedIssues, setSelectedIssues] = useState<GithubIssue[]>([]);
  const [selectedWorkItems, setSelectedWorkItems] = useState<AzureDevOpsWorkItem[]>([]);

  const showGithub = linkedItems === 'issues' && ghAvailable;
  const showAdo = linkedItems === 'workItems' && adoConfigured;

  // Fall back to fetching here when App couldn't pre-fetch — either the modal
  // opened before App's effect settled, or git was just initialized in this modal.
  useEffect(() => {
    if (gitReady && branches.length === 0) void fetchBranches();
  }, [gitReady, projectPath]);

  // Search callbacks for SearchableMultiSelect
  const searchGithubIssues = useCallback(
    (query: string) => window.electronAPI.githubSearchIssues(projectPath, query),
    [projectPath],
  );

  const searchAdoWorkItems = useCallback(
    (query: string) => window.electronAPI.adoSearchWorkItems(query, projectId),
    [projectId],
  );

  async function fetchBranches() {
    setBranchLoading(true);
    setBranchError(null);
    try {
      const resp = await window.electronAPI.gitListBranches(projectPath);
      if (resp.success && resp.data) {
        setBranches(resp.data);
        if (!selectedBranch && resp.data.length > 0) {
          setSelectedBranch(resp.data[0]!);
        }
      } else {
        setBranchError(resp.error || 'Failed to load branches');
      }
    } catch (err) {
      setBranchError(String(err));
    } finally {
      setBranchLoading(false);
      setBranchFetchDone(true);
    }
  }

  async function handleGitInit() {
    setGitInitLoading(true);
    try {
      const resp = await window.electronAPI.gitInit(projectPath);
      if (resp.success) {
        setGitReady(true);
        setUseWorktree(true);
        onGitInit?.();
      }
    } finally {
      setGitInitLoading(false);
    }
  }

  // A fresh git repo (no commits/branches) can't host a worktree and has no
  // branch to select — surface it as an in-place task instead of dead-ending
  // the disabled "Create Task" button.
  const { repoHasNoCommits, requiresBranchSelection } = getTaskCreatability({
    gitReady,
    branchFetchDone,
    branchError: !!branchError,
    branchCount: branches.length,
    hasSelectedBranch: !!selectedBranch,
  });

  const directCheckout = isDirectCheckout({ createNewBranch, useWorktree });
  // A worktree can't be created on a branch that's already checked out (primary
  // repo or another worktree) — git refuses it. Block that selection up front
  // and steer toward "Create new branch". In-place checkout is exempt: switching
  // the primary repo to its own current branch is legal.
  const branchInUse = useWorktree && !createNewBranch && !!selectedBranch?.checkedOut;
  // Name the holder: the project's own checkout, a (possibly archived) task,
  // or a foreign worktree. `tasksByProject` includes archived tasks.
  const projectTasks = useProjects((s) => (projectId ? s.tasksByProject[projectId] : undefined));
  const branchHolder = branchInUse
    ? describeBranchHolder(
        findBranchHolder(selectedBranch?.checkedOutPath, projectPath, projectTasks ?? []),
      )
    : '';

  // The PR head has been fetched to `branch`. Drive the existing flow on it,
  // honoring the current mode: in "Create new branch" it becomes the base for a
  // fresh branch; otherwise it's checked out directly (worktree-existing). The
  // create handler keys off createNewBranch, so leave that toggle as-is. Prefill
  // the name from the PR title if the user hasn't typed one.
  function handlePrPrepared(branch: string, prTitle: string, checkedOut: boolean) {
    setUseWorktree(true);
    const prBranch: BranchInfo = {
      name: branch,
      ref: branch,
      shortHash: '',
      relativeDate: '',
      checkedOut,
    };
    setBranches((prev) => (prev.some((b) => b.name === branch) ? prev : [prBranch, ...prev]));
    setSelectedBranch(prBranch);
    setUpdateFromRemote(false);
    if (!name.trim()) setName(prTitle.slice(0, 60));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || isCreating) return;

    // Build unified linkedItems from both providers
    const ghItems: LinkedItem[] = selectedIssues.map(linkedGithubIssue);
    const adoItems: LinkedItem[] = selectedWorkItems.map(linkedAdoWorkItem);
    const allLinkedItems: LinkedItem[] = [...ghItems, ...adoItems];
    const linkedItems = allLinkedItems.length > 0 ? allLinkedItems : undefined;

    const base = {
      name: name.trim(),
      permissionMode,
      model,
      effort,
      agent,
      linkedItems,
      contextPrompt: contextPrompt.trim() || undefined,
      // Hidden toggle (win32, or info not loaded yet) → no access, as shown.
      dashAccess: controlSupported ? dashAccess : false,
      // '' (not undefined) when cleared: the project default was prefilled.
      extraArgs: extraArgs.trim(),
      // [] (not undefined) when cleared, as above.
      addDirs: normalizeAddDirs(addDirs),
    };

    // The "Update from remote" choice only applies to a direct checkout of a
    // branch that's behind its upstream — mirror the banner's visibility.
    const behind = selectedBranch?.upstream?.behind ?? 0;
    const wantRemote = updateFromRemote && behind > 0 && directCheckout;

    let options: CreateTaskOptions;
    if (repoHasNoCommits) {
      // No commits yet → run in the project dir; worktrees need a base commit.
      options = { ...base, kind: 'in-place-no-git' };
    } else if (useWorktree) {
      if (createNewBranch && selectedBranch) {
        options = { ...base, kind: 'worktree-new-branch', baseRef: selectedBranch.ref, pushRemote };
      } else if (selectedBranch) {
        options = {
          ...base,
          kind: 'worktree-existing',
          branch: selectedBranch.name,
          updateFromRemote: wantRemote,
        };
      } else {
        return; // Submit was gated by the disabled check; defensive.
      }
    } else if (gitReady && selectedBranch) {
      options = {
        ...base,
        kind: 'in-place-checkout',
        branch: selectedBranch.name,
        updateFromRemote: wantRemote,
      };
    } else {
      options = { ...base, kind: 'in-place-no-git' };
    }

    setIsCreating(true);
    try {
      const ok = await onCreate(options);
      if (ok) close();
    } finally {
      setIsCreating(false);
    }
  }

  const behind = selectedBranch?.upstream?.behind ?? 0;
  const ahead = selectedBranch?.upstream?.ahead ?? 0;
  const offersPrs = showGithub || showAdo;
  const canSubmit =
    !!name.trim() &&
    !isCreating &&
    // Block submit when git is ready but no branch is selected (e.g. branch
    // fetch failed). Otherwise we'd silently create the task on whatever
    // branch the project happens to be on. Waived for a commitless repo,
    // which legitimately has no branch to select.
    !requiresBranchSelection &&
    // Worktree on an already-checked-out branch would fail at create.
    !branchInUse &&
    extraArgsOk &&
    addDirsOk;

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeader
        title="New task"
        description={projectPath.split(/[\\/]/).pop()}
        closeDisabled={isCreating}
      />
      <DialogBody>
        <div className="grid grid-cols-2 items-start gap-x-6">
          {/* ── Left: where and how the task runs ── */}
          <div className="grid min-w-0 gap-5">
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Fix auth bug, add dark mode…"
                maxLength={60}
                autoFocus
              />
            </Field>

            {gitReady && repoHasNoCommits ? (
              <Notice icon={<FolderGit2 size={14} strokeWidth={1.8} />}>
                No commits yet, so this task runs in the project folder. Make a first commit to use
                worktrees and branches.
              </Notice>
            ) : !gitReady ? (
              <SettingRow
                label="Not a git repository"
                hint="The task runs in the project folder."
                control={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleGitInit()}
                    disabled={gitInitLoading}
                  >
                    {gitInitLoading ? 'Initializing…' : 'Initialize Git'}
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-1">
                <SwitchField
                  label="Git worktree"
                  hint="An isolated checkout for this task."
                  helperText={
                    worktreeForced
                      ? `A task outside a worktree already exists: ${existingNonWorktreeTask.name}`
                      : undefined
                  }
                  checked={useWorktree}
                  onCheckedChange={(on) => {
                    if (!worktreeForced) setUseWorktree(on);
                  }}
                  locked={worktreeForced}
                />
                {useWorktree && (
                  <SwitchField
                    label="New branch"
                    hint={offersPrs ? 'From a base branch or PR.' : 'From a base branch.'}
                    checked={createNewBranch}
                    // Keep the current selection across the toggle: it carries
                    // over as the base branch (and an in-use branch, blocked
                    // for checkout, becomes a valid base to start from).
                    onCheckedChange={setCreateNewBranch}
                  />
                )}
                {useWorktree && createNewBranch && (
                  <SwitchField
                    label="Push the branch"
                    hint={name.trim() ? `origin/${branchSlug(name.trim())}` : 'To origin.'}
                    checked={pushRemote}
                    onCheckedChange={setPushRemote}
                  />
                )}
              </div>
            )}

            {gitReady && !repoHasNoCommits && (
              <Field
                as="div"
                label={
                  useWorktree && createNewBranch
                    ? offersPrs
                      ? 'Base branch or PR'
                      : 'Base branch'
                    : 'Branch'
                }
              >
                <BranchPrPicker
                  branches={branches}
                  selectedBranch={selectedBranch}
                  branchLoading={branchLoading}
                  branchError={branchError}
                  onSelectBranch={(b) => {
                    setSelectedBranch(b);
                    setUpdateFromRemote(false);
                  }}
                  onRetry={() => {
                    void fetchBranches();
                  }}
                  showPrs={offersPrs}
                  markInUse={!createNewBranch}
                  showUpstream={directCheckout}
                  projectPath={projectPath}
                  projectId={projectId}
                  onSelectPr={handlePrPrepared}
                  initialPr={fromPr}
                />

                {/* Selected branch is checked out elsewhere, so a worktree on it
                    would fail. Block it and point at "New branch". */}
                {branchInUse && (
                  <Notice icon={<GitBranch size={14} strokeWidth={1.8} />}>
                    {selectedBranch?.name} is checked out{branchHolder ? ` ${branchHolder}` : ''}.
                    Turn on New branch to start from it, or pick a free branch.
                  </Notice>
                )}

                {selectedBranch && !branchError && !branchInUse && behind > 0 && directCheckout && (
                  <div className="grid gap-2">
                    <Notice icon={<ArrowDown size={14} strokeWidth={1.8} />}>
                      {behind} {behind === 1 ? 'commit' : 'commits'} behind the remote.{' '}
                      {updateFromRemote
                        ? `${selectedBranch.name} is fast-forwarded to origin first.`
                        : 'The local branch is used as it is.'}
                    </Notice>
                    <Segmented<'local' | 'pull'>
                      size="sm"
                      fullWidth={false}
                      aria-label="Behind the remote"
                      value={updateFromRemote ? 'pull' : 'local'}
                      onChange={(v) => setUpdateFromRemote(v === 'pull')}
                      options={[
                        { value: 'local', label: 'Use local' },
                        { value: 'pull', label: 'Update from remote' },
                      ]}
                    />
                  </div>
                )}
                {/* New-branch case: the branch is cut from the freshly fetched
                    remote ref, so the local branch's ahead/behind isn't used. */}
                {selectedBranch &&
                  !branchError &&
                  !branchInUse &&
                  !directCheckout &&
                  selectedBranch.upstream && (
                    <p className="type-caption">
                      Starts from the latest origin/{selectedBranch.name}.
                    </p>
                  )}
                {selectedBranch &&
                  !branchError &&
                  !branchInUse &&
                  directCheckout &&
                  behind === 0 &&
                  ahead > 0 && (
                    <p className="type-caption tabular-nums">
                      {ahead} {ahead === 1 ? 'commit' : 'commits'} ahead of the remote.
                    </p>
                  )}
              </Field>
            )}

            <div className="grid gap-1">
              <PermissionModePicker
                layout="row"
                width="sm"
                value={permissionMode}
                onChange={setPermissionMode}
                bypass={bypass}
              />
              <ModelPicker layout="row" width="sm" value={model} onChange={setModel} />
              <EffortPicker width="sm" value={effort} onChange={setEffort} />
              <AgentPicker
                projectPath={projectPath}
                extraArgs={taskDefaults?.extraArgs}
                value={agent}
                onChange={setAgent}
              />
              {controlSupported && (
                <SwitchField
                  label="Dash access"
                  hint="The agent can use Dash: its ports and services, tasks of its own, and PR review drafts. Adds a dash skill to the checkout (.claude/skills/dash, kept out of git) that explains dashctl."
                  checked={dashAccess}
                  onCheckedChange={setDashAccess}
                />
              )}
            </div>
          </div>

          {/* ── Right: what the task starts with ── */}
          <div className="grid min-w-0 gap-5">
            <Expandable label="Context prompt" hint="optional" defaultOpen={!!contextPrompt.trim()}>
              {/* The prompt opens the task's first message, so a leading
                  /command runs: `/` there lists the project's skills and commands. */}
              <SuggestionMenu
                open={slash.open}
                label="Skills and commands"
                items={slash.matches.map((c) => ({
                  value: c.name,
                  label: (
                    <>
                      /{c.name}
                      {c.description && <span className="text-ink-3"> {c.description}</span>}
                    </>
                  ),
                }))}
                active={slash.active}
                onActiveChange={slash.setActive}
                onPick={slash.pick}
                onDismiss={slash.dismiss}
              >
                <Textarea
                  ref={contextField}
                  aria-label="Context prompt"
                  value={contextPrompt}
                  onChange={(e) => {
                    setContextPrompt(e.target.value);
                    slash.track();
                  }}
                  onSelect={slash.track}
                  onKeyDown={(e) => {
                    slash.onKeyDown(e);
                  }}
                  data-owns-escape={slash.open}
                  rows={8}
                  placeholder="Conventions, links, the ask. Start with / to run a skill or command."
                  className="resize-none"
                />
              </SuggestionMenu>
            </Expandable>

            {offersPrs && (
              <Field
                as="div"
                label={
                  showGithub && showAdo
                    ? 'Issues and work items'
                    : showAdo
                      ? 'Work items'
                      : 'Issues'
                }
                trailing="optional"
              >
                {showGithub && (
                  <SearchableMultiSelect<GithubIssue>
                    onSearch={searchGithubIssues}
                    selected={selectedIssues}
                    onSelect={setSelectedIssues}
                    getKey={(i) => i.number}
                    getLabel={(i) => `#${i.number}`}
                    renderItem={(issue) => <GithubIssueRow issue={issue} />}
                    placeholder="Search GitHub issues…"
                  />
                )}
                {showAdo && (
                  <SearchableMultiSelect<AzureDevOpsWorkItem>
                    onSearch={searchAdoWorkItems}
                    selected={selectedWorkItems}
                    onSelect={setSelectedWorkItems}
                    getKey={(i) => i.id}
                    getLabel={(i) => `#${i.id}`}
                    renderItem={(item) => <AdoWorkItemRow item={item} />}
                    placeholder="Search work items…"
                  />
                )}
              </Field>
            )}

            <Expandable
              label="Advanced"
              hint="optional"
              defaultOpen={!!extraArgs.trim() || addDirs.length > 0}
            >
              <AddDirsField value={addDirs} onChange={setAddDirs} />
              <ExtraArgsField value={extraArgs} onChange={setExtraArgs} />
            </Expandable>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close} disabled={isCreating}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {isCreating && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
          {isCreating ? 'Creating…' : 'Create task'}
        </Button>
      </DialogFooter>
    </form>
  );
}
