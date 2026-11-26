/*
 * The Projects view as the shared tree's rows (`ui/Tree`), pure: each project,
 * its tasks while it is open, then its other sessions and archived tasks;
 * archived projects last.
 */
import type { Project, Task } from '../../../shared/types';
import type { TreeNode } from '../ui/treeNav';

export type ProjectTreeRow = TreeNode &
  (
    | { kind: 'project'; project: Project; tasks: Task[] }
    | { kind: 'task'; task: Task; project: Project; siblings: Task[] }
    /** "No tasks yet" under the active project. */
    | { kind: 'empty'; project: Project }
    /** The project's sessions no task owns (`ForeignSessionsSection`). */
    | { kind: 'sessions'; project: Project }
    | { kind: 'archived'; project: Project; tasks: Task[] }
    | { kind: 'archivedTask'; task: Task }
    | { kind: 'archivedProjects'; projects: Project[] }
    | { kind: 'archivedProject'; project: Project }
    /** "Add a project to start", with none listed. */
    | { kind: 'noProjects' }
    /** Room after an open project's rows. */
    | { kind: 'gap' }
  );

export interface ProjectTreeInput {
  projects: Project[];
  tasksByProject: Record<string, Task[]>;
  activeProjectId: string | null;
  /** Open projects. */
  expanded: ReadonlySet<string>;
  /** Projects whose archived tasks are open. */
  openArchived: ReadonlySet<string>;
  archivedProjects: Project[];
  archivedProjectsOpen: boolean;
  /** Whether a project has sessions no task owns. */
  hasOtherSessions: (project: Project) => boolean;
}

/** The rows on show, in order. */
export function projectTreeRows(input: ProjectTreeInput): ProjectTreeRow[] {
  const rows: ProjectTreeRow[] = [];
  if (input.projects.length === 0) {
    rows.push({ kind: 'noProjects', key: 'none', depth: -1, focusable: false });
  }
  for (const project of input.projects) {
    const all = input.tasksByProject[project.id] ?? [];
    const tasks = all.filter((t) => !t.archivedAt);
    const archived = all.filter((t) => t.archivedAt);
    const open = input.expanded.has(project.id);
    const id = project.id;
    rows.push({ kind: 'project', key: `p:${id}`, depth: 0, open, focusable: true, project, tasks });
    if (!open) continue;
    for (const task of tasks) {
      rows.push({
        kind: 'task',
        key: `t:${task.id}`,
        depth: 1,
        focusable: true,
        task,
        project,
        siblings: tasks,
      });
    }
    if (tasks.length === 0 && id === input.activeProjectId) {
      rows.push({ kind: 'empty', key: `e:${id}`, depth: 1, focusable: false, project });
    }
    if (input.hasOtherSessions(project)) {
      rows.push({ kind: 'sessions', key: `s:${id}`, depth: 1, focusable: false, project });
    }
    if (archived.length > 0) {
      const archivedOpen = input.openArchived.has(id);
      rows.push({
        kind: 'archived',
        key: `a:${id}`,
        depth: 1,
        open: archivedOpen,
        focusable: true,
        project,
        tasks: archived,
      });
      if (archivedOpen) {
        for (const task of archived) {
          rows.push({
            kind: 'archivedTask',
            key: `at:${task.id}`,
            depth: 2,
            focusable: true,
            task,
          });
        }
      }
    }
    rows.push({ kind: 'gap', key: `g:${id}`, depth: 1, focusable: false });
  }
  if (input.archivedProjects.length > 0) {
    const open = input.archivedProjectsOpen;
    rows.push({
      kind: 'archivedProjects',
      key: 'ap',
      depth: 0,
      open,
      focusable: true,
      projects: input.archivedProjects,
    });
    if (open) {
      for (const project of input.archivedProjects) {
        rows.push({
          kind: 'archivedProject',
          key: `ap:${project.id}`,
          depth: 1,
          focusable: true,
          project,
        });
      }
    }
  }
  return rows;
}
