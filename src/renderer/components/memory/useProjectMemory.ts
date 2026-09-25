import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ProjectMemory } from '../../../shared/types';

/** Load a project's memory and keep it live while mounted (the modal's lifetime). */
export function useProjectMemory(projectPath: string): {
  memory: ProjectMemory | null;
  error: string | null;
} {
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await window.electronAPI.memoryGet({ projectPath });
        if (cancelled) return;
        if (res.success && res.data) {
          setMemory(res.data);
          setError(null);
        } else {
          setError(res.error ?? 'Could not read memory');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    const watch = async () => {
      try {
        const res = await window.electronAPI.memoryWatch({ projectPath });
        if (!res.success) throw new Error(res.error);
      } catch (err) {
        console.warn('[memory] live updates unavailable', projectPath, err);
        if (!cancelled) toast.error('Memory will not update live', { description: String(err) });
      }
    };
    void load();
    void watch();
    const off = window.electronAPI.onMemoryChanged((changed) => {
      if (changed === projectPath) void load();
    });
    return () => {
      cancelled = true;
      off();
      void window.electronAPI.memoryUnwatch();
    };
  }, [projectPath]);

  return { memory, error };
}
