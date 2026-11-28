import { openFileAt } from '../components/diffEditor/openFileAt';
import { useSettings } from '../stores/settingsStore';
import { linkRange, resolveLinkPath } from '../terminal/fileLinkTarget';

/**
 * Open a file path clicked in a terminal: in the task's own editor, at its
 * line (Settings → Editor › Open files in), or in the external editor when
 * that's the choice or the file is outside the active task's folder.
 */
export async function openFileLink(
  cwd: string,
  filePath: string,
  line?: number,
  col?: number,
): Promise<void> {
  if (useSettings.getState().openFilesIn === 'dash') {
    const abs = resolveLinkPath(cwd, filePath);
    if (abs && openFileAt(abs, linkRange(line, col))) return;
  }
  const res = await window.electronAPI.openInEditor({ cwd, filePath, line, col });
  if (!res.success) console.warn('[FilePathLink] openInEditor failed:', res.error);
}
