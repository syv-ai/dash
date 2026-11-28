import { promises as fs } from 'fs';
import * as path from 'path';
import { GitService } from '../GitService';
import { buildCiReport, ciReportPointer } from '../ciReport';
import type { ForgeProvider, PrContext } from './types';

/** Where "Fix CI" writes its report, relative to the task's checkout. */
const CI_REPORT_DIR = '.claude/dash';

/**
 * Write PR `pr`'s failed checks, as its forge reports them, to a Markdown
 * file in the checkout (`.claude/dash/`, kept out of git via
 * `.git/info/exclude`) and return the one-line prompt pointing at it, or
 * null when no check has failed.
 */
export async function writeCiReport(
  adapter: Pick<ForgeProvider, 'failedChecks'>,
  ctx: PrContext,
  pr: { number: number; url: string; headSha?: string },
): Promise<{ prompt: string; file: string } | null> {
  const checks = await adapter.failedChecks(ctx, pr.number);
  if (checks.length === 0) return null;
  const dir = path.join(ctx.cwd, CI_REPORT_DIR);
  await fs.mkdir(dir, { recursive: true });
  await GitService.ensureExcluded(ctx.cwd, `${CI_REPORT_DIR}/`).catch(() => {});
  const file = path.join(dir, `ci-pr-${pr.number}.md`);
  await fs.writeFile(file, buildCiReport(pr, checks), 'utf-8');
  return { prompt: ciReportPointer(pr.number, file, checks), file };
}
