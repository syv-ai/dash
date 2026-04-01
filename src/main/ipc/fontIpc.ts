import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let cachedFonts: string[] | null = null;

async function detectMonospaceFonts(): Promise<string[]> {
  if (cachedFonts) return cachedFonts;

  try {
    if (process.platform === 'darwin') {
      // macOS: use system_profiler to list all fonts, filter for monospace
      const { stdout } = await execFileAsync('system_profiler', ['SPFontsDataType'], {
        maxBuffer: 10 * 1024 * 1024,
      });
      const families = new Set<string>();
      let currentFamily = '';
      for (const line of stdout.split('\n')) {
        const familyMatch = line.match(/^\s+Family:\s+(.+)/);
        if (familyMatch) {
          currentFamily = familyMatch[1].trim();
        }
        // Look for monospace/fixed-width type indicators
        if (
          currentFamily &&
          (line.includes('Style: Monospaced') ||
            line.includes('Style: Fixed') ||
            /\bMono\b/i.test(currentFamily) ||
            /\bCode\b/i.test(currentFamily) ||
            /\bConsolas\b/i.test(currentFamily) ||
            /\bCourier\b/i.test(currentFamily) ||
            /\bMenlo\b/i.test(currentFamily) ||
            /\bMonaco\b/i.test(currentFamily))
        ) {
          families.add(currentFamily);
        }
      }
      cachedFonts = [...families].sort((a, b) => a.localeCompare(b));
    } else {
      // Linux: use fc-list to find monospace fonts
      const { stdout } = await execFileAsync('fc-list', [
        ':spacing=mono',
        '--format=%{family[0]}\n',
      ]);
      const families = new Set<string>();
      for (const line of stdout.split('\n')) {
        const name = line.trim();
        if (name) families.add(name);
      }
      cachedFonts = [...families].sort((a, b) => a.localeCompare(b));
    }
  } catch {
    cachedFonts = [];
  }

  return cachedFonts;
}

export function registerFontIpc(): void {
  ipcMain.handle('font:getSystemFonts', async () => {
    try {
      const fonts = await detectMonospaceFonts();
      return { success: true, data: fonts };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}
