import { useEffect, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { PrProvider, PrReviewThread } from '../../../../shared/types';
import { PrThreadCard } from './PrThreadCard';

const PAD_PX = 8;
// Before a card is measured: close enough that the first paint barely shifts.
const INITIAL_HEIGHT_PX = 120;
// A resolved thread starts as a one-line pill.
const INITIAL_PILL_PX = 28;
const MIN_CARD_PX = 320;
const MAX_CARD_PX = 640;

interface Props {
  /** Threads on this file's PR-side lines (`line` set, side RIGHT). */
  threads: PrReviewThread[];
  provider: PrProvider;
  draftScope: string | null;
  onSetResolved: (thread: PrReviewThread, resolved: boolean) => void;
  modifiedEditor: monacoEditor.ICodeEditor | null;
  area: HTMLDivElement | null;
  onSend: (thread: PrReviewThread) => void;
}

/**
 * PR review threads drawn under the lines they were left on. A Monaco view
 * zone reserves the space under each line; the card itself is an overlay in
 * the editor area, moved to the zone's top from Monaco's layout callback (the
 * pattern the local comment bubbles use, minus editing and animation).
 */
export function PrThreadOverlay({
  threads,
  provider,
  draftScope,
  onSetResolved,
  modifiedEditor,
  area,
  onSend,
}: Props) {
  const wrappers = useRef(new Map<string, HTMLDivElement>());
  const tops = useRef(new Map<string, number>());
  const zones = useRef(new Map<string, { id: string; zone: monacoEditor.IViewZone }>());
  const heights = useRef(new Map<string, number>());
  const [, rerender] = useState(0);

  // Re-render on layout changes so the horizontal position follows the editor
  // (side by side moves the modified column).
  useEffect(() => {
    if (!modifiedEditor) return;
    const l = modifiedEditor.onDidLayoutChange(() => rerender((n) => n + 1));
    return () => l.dispose();
  }, [modifiedEditor]);

  // One zone per thread, below its last line.
  useEffect(() => {
    if (!modifiedEditor) return;
    const placeAt = (id: string) => {
      const el = wrappers.current.get(id);
      const top = tops.current.get(id);
      if (el && top !== undefined) el.style.top = `${top + PAD_PX}px`;
    };
    modifiedEditor.changeViewZones((acc) => {
      for (const t of threads) {
        const zone: monacoEditor.IViewZone = {
          afterLineNumber: t.line ?? 0,
          heightInPx:
            (heights.current.get(t.id) ?? (t.resolved ? INITIAL_PILL_PX : INITIAL_HEIGHT_PX)) +
            PAD_PX * 2,
          domNode: Object.assign(document.createElement('div'), { style: 'pointer-events:none' }),
          onDomNodeTop: (top) => {
            tops.current.set(t.id, top);
            placeAt(t.id);
          },
        };
        zones.current.set(t.id, { id: acc.addZone(zone), zone });
      }
    });
    const current = zones.current;
    const currentTops = tops.current;
    return () => {
      modifiedEditor.changeViewZones((acc) => {
        for (const { id } of current.values()) acc.removeZone(id);
      });
      current.clear();
      currentTops.clear();
    };
  }, [modifiedEditor, threads]);

  // Size each zone to its card.
  useEffect(() => {
    if (!modifiedEditor) return;
    const observer = new ResizeObserver((entries) => {
      const changed: string[] = [];
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.threadId;
        const h = Math.ceil(entry.contentRect.height);
        if (id && heights.current.get(id) !== h) {
          heights.current.set(id, h);
          changed.push(id);
        }
      }
      if (changed.length === 0) return;
      modifiedEditor.changeViewZones((acc) => {
        for (const id of changed) {
          const entry = zones.current.get(id);
          if (!entry) continue;
          entry.zone.heightInPx = heights.current.get(id)! + PAD_PX * 2;
          acc.layoutZone(entry.id);
        }
      });
    });
    for (const el of wrappers.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [modifiedEditor, threads]);

  if (!modifiedEditor || !area || threads.length === 0) return null;
  const layout = modifiedEditor.getLayoutInfo();
  const editorX =
    (modifiedEditor.getDomNode()?.getBoundingClientRect().left ?? 0) -
    area.getBoundingClientRect().left;
  const left = editorX + layout.contentLeft;
  const width = Math.min(
    Math.max(Math.round(layout.contentWidth * 0.7), MIN_CARD_PX),
    MAX_CARD_PX,
    layout.width - layout.contentLeft - 16,
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-[5]">
      {threads.map((t) => (
        <div
          key={t.id}
          data-thread-id={t.id}
          ref={(el) => {
            if (el) wrappers.current.set(t.id, el);
            else wrappers.current.delete(t.id);
          }}
          className="absolute pointer-events-auto"
          style={{ top: -9999, left, width }}
        >
          <PrThreadCard
            thread={t}
            provider={provider}
            draftScope={draftScope}
            onSend={onSend}
            onSetResolved={onSetResolved}
          />
        </div>
      ))}
    </div>
  );
}
