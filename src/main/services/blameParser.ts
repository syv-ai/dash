import type { BlameLine } from '@shared/types';

/** All-zeros SHA git uses for not-yet-committed (working tree) lines. */
export const UNCOMMITTED_SHA = '0000000000000000000000000000000000000000';

interface CommitMeta {
  author: string;
  authorEmail: string;
  authorTime: number;
  summary: string;
}

const HEADER_RE = /^([0-9a-f]{40}) \d+ (\d+) (\d+)$/;

/**
 * Parse `git blame --incremental <ref?> -- <path>` output into one BlameLine per
 * final line, in ascending line order.
 *
 * Incremental format: each group starts with a header line
 * `<sha> <origLine> <finalLine> <numLines>`, followed by commit metadata
 * key/value lines, and terminates on a `filename` line. Metadata is emitted only
 * the first time a commit is seen, so we cache it per-sha and reuse it for later
 * groups of the same commit. Groups can arrive out of final-line order, so we
 * place each into a line-indexed slot and compact at the end.
 */
export function parseBlameIncremental(stdout: string): BlameLine[] {
  const commits = new Map<string, CommitMeta>();
  const byLine: BlameLine[] = [];

  let sha = '';
  let finalLine = 0;
  let count = 0;

  const metaFor = (key: string): CommitMeta => {
    let m = commits.get(key);
    if (!m) {
      m = { author: '', authorEmail: '', authorTime: 0, summary: '' };
      commits.set(key, m);
    }
    return m;
  };

  for (const raw of stdout.split('\n')) {
    if (!raw) continue;

    const header = HEADER_RE.exec(raw);
    if (header) {
      sha = header[1]!;
      finalLine = parseInt(header[2]!, 10);
      count = parseInt(header[3]!, 10);
      metaFor(sha); // ensure an entry exists even if metadata is omitted (repeat commit)
      continue;
    }
    if (!sha) continue;

    const sp = raw.indexOf(' ');
    const key = sp === -1 ? raw : raw.slice(0, sp);
    const value = sp === -1 ? '' : raw.slice(sp + 1);
    const meta = metaFor(sha);

    switch (key) {
      case 'author':
        meta.author = value;
        break;
      case 'author-mail':
        meta.authorEmail = value.replace(/^<|>$/g, '');
        break;
      case 'author-time':
        meta.authorTime = parseInt(value, 10) || 0;
        break;
      case 'summary':
        meta.summary = value;
        break;
      case 'filename': {
        // Group complete — emit one BlameLine per covered line.
        const uncommitted = sha === UNCOMMITTED_SHA;
        const shortSha = sha.slice(0, 7);
        for (let i = 0; i < count; i++) {
          const ln = finalLine + i;
          byLine[ln - 1] = {
            line: ln,
            sha,
            shortSha,
            author: meta.author,
            authorEmail: meta.authorEmail,
            authorTime: meta.authorTime,
            summary: meta.summary,
            uncommitted,
          };
        }
        break;
      }
      default:
        break; // committer*, author-tz, previous, boundary — ignored
    }
  }

  return byLine.filter(Boolean) as BlameLine[];
}
