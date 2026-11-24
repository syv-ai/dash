import { toast } from 'sonner';

/** Put `text` on the clipboard and say so (`what`: "relative path"). */
export function copyText(text: string, what: string): void {
  window.electronAPI.clipboardWriteText(text);
  toast(`Copied ${what}`, { description: text.length > 80 ? undefined : text, duration: 1800 });
}

/** "Reveal in Finder", in the platform's words. */
export function revealLabel(): string {
  const platform = window.electronAPI.getPlatform();
  if (platform === 'darwin') return 'Reveal in Finder';
  if (platform === 'win32') return 'Reveal in File Explorer';
  return 'Reveal in file manager';
}
