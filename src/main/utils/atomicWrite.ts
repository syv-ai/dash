import * as crypto from 'crypto';
import * as fs from 'fs';

/**
 * Write `data` to `file` via a sibling tmp file and a rename, so a reader (or
 * a crash mid-write) never sees a partial file. With `mode`, the file is
 * created with it and chmod'ed to it, since the umask may have masked bits off
 * the create mode. The tmp file is removed best-effort when anything fails.
 * The parent directory must exist.
 */
export function writeFileAtomic(
  file: string,
  data: string | Buffer,
  opts: { mode?: number } = {},
): void {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    if (opts.mode === undefined) {
      fs.writeFileSync(tmp, data);
    } else {
      fs.writeFileSync(tmp, data, { mode: opts.mode });
      fs.chmodSync(tmp, opts.mode);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
