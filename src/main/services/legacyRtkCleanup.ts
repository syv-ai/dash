import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';

/**
 * Dash before RTK's removal could download the `rtk` binary into
 * `<userData>/bin`, link it at `~/.local/bin/rtk`, keep its toggle in
 * `<userData>/rtk-config.json` and add a `__dash`-tagged `rtk hook claude`
 * PreToolUse hook to each task's settings.local.json. This removes what Dash
 * itself left: a user-installed `rtk` (not a symlink to Dash's copy) stays.
 *
 * Returns whether anything was found, so the caller can rewrite live
 * sessions' hook settings (the merge drops the stale `__dash` hook).
 */
export function removeLegacyRtk(): boolean {
  const userData = app.getPath('userData');
  const config = path.join(userData, 'rtk-config.json');
  const binDir = path.join(userData, 'bin');
  const binary = path.join(binDir, process.platform === 'win32' ? 'rtk.exe' : 'rtk');
  const link = path.join(os.homedir(), '.local', 'bin', 'rtk');

  const found = fs.existsSync(config) || fs.existsSync(binary);
  try {
    if (fs.lstatSync(link).isSymbolicLink() && fs.readlinkSync(link) === binary) {
      fs.rmSync(link);
    }
  } catch {
    // No link there.
  }
  fs.rmSync(config, { force: true });
  fs.rmSync(binary, { force: true });
  try {
    fs.rmdirSync(binDir); // Only when empty.
  } catch {
    // Missing, or holds something else.
  }
  return found;
}
