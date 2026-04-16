import { toast } from 'sonner';

export async function openInIde(folderPath: string): Promise<void> {
  const preferredIDE = localStorage.getItem('preferredIDE') || 'auto';

  let customCommand: { path: string; args: string[] } | undefined;
  if (preferredIDE === 'custom') {
    try {
      const raw = localStorage.getItem('customIDE');
      if (raw) customCommand = JSON.parse(raw);
    } catch (err) {
      // Leave customCommand undefined so the main process surfaces a clear
      // "No custom IDE configured" toast rather than crashing on exec.
      console.warn('[openInIDE] Failed to parse customIDE from localStorage:', err);
    }
  }

  const res = await window.electronAPI.openInIDE({
    folderPath,
    ide: preferredIDE,
    customCommand,
  });

  if (!res.success) {
    toast.error(res.error || 'Failed to open in IDE');
  }
}
