import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ProjectMemory } from '../../../shared/types';

/** Load a project's memory and keep it live while mounted (the modal's lifetime). */
export function useProjectMemory(projectPath: string): {
  memory: ProjectMemory | null;
  error: string | null;
  /** Re-read now, without waiting for the watcher; resolves with what was read. */
  reload: () => Promise<ProjectMemory | null>;
} {
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef<() => Promise<ProjectMemory | null>>(() => Promise.resolve(null));

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<ProjectMemory | null> => {
      try {
        const res = await window.electronAPI.memoryGet({ projectPath });
        if (cancelled) return null;
        if (res.success && res.data) {
          setMemory(res.data);
          setError(null);
          return res.data;
        }
        setError(res.error ?? 'Could not read memory');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
      return null;
    };
    loadRef.current = load;
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

  const reload = useCallback(() => loadRef.current(), []);
  return { memory, error, reload };
}
