import * as fs from 'fs';
import path from 'path';

/**
 * Ports onboarding is only relevant when the worktree has no
 * `.dash/ports.json` yet — a project that already carries one (committed, or
 * written by a previous setup run) is configured; offering setup again would
 * re-onboard an already-onboarded project.
 */
export function portsOnboardingRelevant(cwd: string): boolean {
  return !fs.existsSync(path.join(cwd, '.dash', 'ports.json'));
}
