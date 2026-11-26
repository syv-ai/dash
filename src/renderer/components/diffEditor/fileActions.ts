import { toast } from '../ui/toast';

/** Put `text` on the clipboard and say so (`what`: "relative path"). */
export function copyText(text: string, what: string): void {
  window.electronAPI.clipboardWriteText(text);
  toast.copied(what, text);
}

/** "Reveal in Finder", in the platform's words. */
export function revealLabel(): string {
  const platform = window.electronAPI.getPlatform();
  if (platform === 'darwin') return 'Reveal in Finder';
  if (platform === 'win32') return 'Reveal in File Explorer';
  return 'Reveal in file manager';
}
