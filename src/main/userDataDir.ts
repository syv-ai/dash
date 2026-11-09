import * as path from 'path';

/**
 * Where Dash keeps its data (DB, snapshots, the hook-port and control files,
 * the single-instance lock), or null to keep Electron's default
 * (`<appData>/Dash`, the installed app's). `DASH_USER_DATA_DIR` wins, for an
 * extra isolated instance. Otherwise an unpackaged run (`pnpm dev`) gets its
 * own `Dash-dev`, so it never shares the installed app's database or answers
 * outside `dashctl` calls in its place.
 */
export function userDataDir(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  appData: string,
): string | null {
  if (env.DASH_USER_DATA_DIR) return path.resolve(env.DASH_USER_DATA_DIR);
  if (!isPackaged) return path.join(appData, 'Dash-dev');
  return null;
}
