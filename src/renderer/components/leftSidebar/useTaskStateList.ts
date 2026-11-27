import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProjects } from '../../stores/projectsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { useSettings } from '../../stores/settingsStore';
import { listedActivity, orderTasksByState, type TaskStateList } from './taskStates';

/** Every live task across projects in state order (see orderTasksByState). */
export function useTaskStateList(): TaskStateList {
  const tasksByProject = useProjects((s) => s.tasksByProject);
  const projects = useProjects((s) => s.projects);
  const activity = useRuntime(useShallow((s) => listedActivity(s.taskActivity)));
  const unseen = useSettings((s) => s.unseenTaskIds);
  return useMemo(
    () => orderTasksByState(Object.values(tasksByProject).flat(), activity, unseen, projects),
    [tasksByProject, activity, unseen, projects],
  );
}
