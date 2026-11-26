import { useEffect, useRef, useState } from 'react';
import type { ProjectMemory } from '../../../shared/types';

/**
 * Load a project's memory, again each time its folder changes on disk (main
 * watches every project's): an edit saved in the editor, a memory Claude
 * writes, one made or deleted from the Agent tab.
 */
export function useProjectMemory(
  /** Null: none read (the pane isn't showing). */
  projectPath: string | null,
): {
  memory: ProjectMemory | null;
  error: string | null;
} {
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the folder changes, which reads it again.
  const [reads, setReads] = useState(0);
  const dirRef = useRef<string | null>(null);
  dirRef.current = memory?.dir ?? null;

  useEffect(
    () =>
      window.electronAPI.onMemoryChanged(({ dir }) => {
        if (dirRef.current === null || dirRef.current === dir) setReads((n) => n + 1);
      }),
    [],
  );

  useEffect(() => {
    if (projectPath === null) return;
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
  }, [projectPath, reads]);

  return { memory, error };
}
