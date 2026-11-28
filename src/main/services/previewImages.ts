import { promises as fs } from 'fs';
import path from 'path';
import { resolveEditorPath } from './editorPaths';
import type { PreviewImage } from '@shared/types';

/*
 * The images a rendered preview (Markdown, HTML) names by a relative path,
 * read for it to inline as `data:` URIs: its CSP keeps `img-src data:`, so
 * the page still reaches no network and no file by itself. A document is
 * untrusted content and nobody picked these files, so each read is narrow:
 * an image type by its extension and by its first bytes, inside the editor's
 * root with no link out of it (`resolveEditorPath`'s `embed`), and capped.
 */

/** [provisional] One image's cap, and one document's, so a page can't make
 *  main read (and the renderer hold) much more than a page of screenshots. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
/** [provisional] More references than this in one document read nothing. */
export const DOCUMENT_MAX_IMAGES = 200;

type ImageType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'
  | 'image/avif';

const BY_EXTENSION: Record<string, ImageType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

const ascii = (buf: Buffer, start: number, end: number) => buf.toString('latin1', start, end);

/** An SVG's text: an optional BOM, XML declaration, comments and doctype, then `<svg`. */
const SVG_START =
  /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!doctype[^>]*>)\s*)*<svg[\s>/]/i;

/** The image type `buf`'s first bytes say it is, or null. */
export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a)
    return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(ascii(buf, 0, 6))) return 'image/gif';
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP')
    return 'image/webp';
  if (buf.length >= 12 && ascii(buf, 4, 8) === 'ftyp') {
    // The ftyp box: its major brand, then its compatible ones.
    const boxEnd = Math.min(buf.readUInt32BE(0), buf.length);
    for (let at = 8; at + 4 <= boxEnd; at += at === 8 ? 8 : 4) {
      if (/^avi[fs]$/.test(ascii(buf, at, at + 4))) return 'image/avif';
    }
    return null;
  }
  if (SVG_START.test(buf.toString('utf8', 0, Math.min(buf.length, 4096)))) return 'image/svg+xml';
  return null;
}

/**
 * Each of `paths` (as the renderer resolved them from the document's folder:
 * repo-relative in `cwd`, or absolute in one of `outside`) as a `data:` URI,
 * or why not. In order; once the document's total is spent, the rest are
 * refused as too big.
 */
export async function readPreviewImages(
  cwd: string,
  paths: readonly string[],
  outside: readonly string[],
): Promise<PreviewImage[]> {
  let budget = DOCUMENT_MAX_BYTES;
  const out: PreviewImage[] = [];
  for (const [i, p] of paths.entries()) {
    if (i >= DOCUMENT_MAX_IMAGES) {
      out.push({ refused: 'size' });
      continue;
    }
    const image = await readOne(cwd, p, outside, budget);
    if ('dataUri' in image) budget -= image.bytes;
    out.push('dataUri' in image ? { dataUri: image.dataUri } : image);
  }
  return out;
}

async function readOne(
  cwd: string,
  filePath: string,
  outside: readonly string[],
  budget: number,
): Promise<{ dataUri: string; bytes: number } | Extract<PreviewImage, { refused: unknown }>> {
  const type = BY_EXTENSION[path.extname(filePath).toLowerCase()];
  if (!type) return { refused: 'type' };
  let abs: string;
  try {
    abs = resolveEditorPath(cwd, filePath, outside, 'embed').abs;
  } catch {
    return { refused: 'outside' };
  }
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return { refused: 'missing' };
  }
  if (!stat.isFile()) return { refused: 'missing' };
  if (stat.size > Math.min(IMAGE_MAX_BYTES, budget)) return { refused: 'size' };
  const buf = await fs.readFile(abs);
  // Read again: it may have grown since the stat.
  if (buf.length > Math.min(IMAGE_MAX_BYTES, budget)) return { refused: 'size' };
  if (sniffImageType(buf) !== type) return { refused: 'type' };
  return { dataUri: `data:${type};base64,${buf.toString('base64')}`, bytes: buf.length };
}
