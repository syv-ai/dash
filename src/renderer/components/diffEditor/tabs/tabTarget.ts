import type { PrProvider } from '../../../../shared/types';

/** What an editor tab shows. Tabs are strings: a repo-relative file path, or
 *  a reserved `dash:pr/<provider>/<number>` for a PR's overview (D4). */
export type TabTarget =
  | { kind: 'file'; path: string }
  | { kind: 'pr'; provider: PrProvider; number: number };

/** The tab of a PR's overview. The one owner of that format, with `tabTarget`. */
export const prTab = (provider: PrProvider, number: number): string =>
  `dash:pr/${provider}/${number}`;

/** What `tab` shows; anything not in the reserved format is a file path. */
export function tabTarget(tab: string): TabTarget {
  const m = /^dash:pr\/(github|ado)\/(\d+)$/.exec(tab);
  return m
    ? { kind: 'pr', provider: m[1] as PrProvider, number: Number(m[2]) }
    : { kind: 'file', path: tab };
}

/** Whether `tab` is a file's: what the file-only paths (buffers, dirty checks,
 *  retain on view change) filter on. */
export const isFileTab = (tab: string): boolean => tabTarget(tab).kind === 'file';
