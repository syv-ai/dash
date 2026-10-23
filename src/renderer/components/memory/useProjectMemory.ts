import { useEffect, useState } from 'react';
import type { ProjectMemory } from '../../../shared/types';

/**
 * Load a project's memory, and again each time `paused` turns false: the
 * modal pauses while a memory is open in the editor and reads the result back
 * once it closes.
 */
export function useProjectMemory(
  projectPath: string,
  paused: boolean,
): {
  memory: ProjectMemory | null;
  error: string | null;
} {
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    void (async () => {
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
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, paused]);

  return { memory, error };
}
