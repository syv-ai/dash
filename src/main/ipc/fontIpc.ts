import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let cachedFonts: string[] | null = null;

const APPLESCRIPT_MONO_FONTS = `
use framework "AppKit"
set fm to current application's NSFontManager's sharedFontManager()
set fonts to fm's availableFontFamilies() as list
set monoFonts to {}
repeat with f in fonts
  set members to fm's availableMembersOfFontFamily:(f as text)
  if members is not missing value and (count of members) > 0 then
    set traits to item 4 of item 1 of (members as list)
    if (traits mod 2048) div 1024 = 1 then
      set end of monoFonts to (f as text)
    end if
  end if
end repeat
set AppleScript's text item delimiters to "\\n"
return monoFonts as text`;

async function detectMonospaceFonts(): Promise<string[]> {
  if (cachedFonts && cachedFonts.length > 0) return cachedFonts;

  try {
    let stdout: string;
    if (process.platform === 'darwin') {
      // macOS: use NSFontManager via AppleScript to reliably detect fixed-pitch fonts
      ({ stdout } = await execFileAsync('/usr/bin/osascript', ['-e', APPLESCRIPT_MONO_FONTS], {
        timeout: 15000,
      }));
    } else {
      // Linux: use fc-list to find monospace fonts
      ({ stdout } = await execFileAsync('fc-list', [':spacing=mono', '--format=%{family[0]}\n']));
    }
    const families = new Set<string>();
    for (const line of stdout.split('\n')) {
      const name = line.trim();
      if (name) families.add(name);
    }
    cachedFonts = [...families].sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.error('[fontIpc] Failed to detect system fonts:', err);
    cachedFonts = null;
  }

  return cachedFonts ?? [];
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
