import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PreviewImage } from '../../../../shared/types';
import { useTreeVersion } from '../../fileTree/useTreeVersion';
import { isOutsideWorktree } from './fileRef';
import { previewImageSources, type PreviewKind } from './previewDocument';
import { resolveImageSrc, type ImageShown } from './previewImages';

const REFUSED: Record<Extract<PreviewImage, { refused: unknown }>['refused'], string> = {
  outside: 'Not shown: outside this project',
  type: 'Not shown: not a PNG, JPEG, GIF, WebP, SVG or AVIF image',
  size: 'Not shown: too big to preview',
  missing: 'Not found',
};

/**
 * What the preview of `text` (the file `filePath` in `cwd`) shows for each
 * `<img src>`: its local files read through main in one call per set, so
 * main holds the document to its cap, and read again when a file under
 * `cwd` changes (the tree's watch; an outside document's folder isn't
 * watched). A read in flight keeps the last one's images, so typing doesn't
 * flash them.
 */
export function usePreviewImages(
  cwd: string,
  filePath: string,
  kind: PreviewKind,
  text: string,
): (src: string) => ImageShown | null {
  const resolved = useMemo(() => {
    const bySrc = new Map(
      previewImageSources(kind, text).map((src) => [src, resolveImageSrc(filePath, src)]),
    );
    const paths = [
      ...new Set([...bySrc.values()].flatMap((r) => (r.kind === 'file' ? [r.path] : []))),
    ].sort();
    return { bySrc, paths, key: paths.join('\0') };
  }, [kind, text, filePath]);
  const { bySrc, paths, key } = resolved;

  const watching = paths.length > 0 && !isOutsideWorktree(filePath);
  const treeVersion = useTreeVersion(cwd, watching);
  const [read, setRead] = useState<{ cwd: string; images: ReadonlyMap<string, PreviewImage> }>(
    () => ({ cwd, images: new Map() }),
  );
  useEffect(() => {
    if (!key) return;
    const wanted = key.split('\0');
    let cancelled = false;
    void window.electronAPI.editorReadImages({ cwd, paths: wanted }).then((resp) => {
      if (cancelled) return;
      const images: PreviewImage[] = resp.success
        ? resp.data!
        : wanted.map(() => ({ refused: 'missing' }));
      setRead({ cwd, images: new Map(wanted.map((p, i) => [p, images[i]!])) });
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, key, treeVersion]);

  return useCallback(
    (src: string): ImageShown | null => {
      const ref = bySrc.get(src);
      if (!ref || ref.kind === 'data') return null;
      if (ref.kind === 'remote') return ref;
      if (ref.kind === 'refused') return { kind: 'missing', reason: REFUSED.outside };
      const image = read.cwd === cwd ? read.images.get(ref.path) : undefined;
      if (!image) return { kind: 'pending' };
      return 'dataUri' in image
        ? { kind: 'data', uri: image.dataUri }
        : { kind: 'missing', reason: REFUSED[image.refused] };
    },
    [bySrc, read, cwd],
  );
}
