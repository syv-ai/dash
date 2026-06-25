import { useCallback, useEffect, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { BlameLine } from '@shared/types';
import type { EditorView } from '../types';
import { refForView } from './refForView';
import { blameLabel, contiguousBlock, type BlameLabel } from './formatBlame';

interface Args {
  cwd: string;
  filePath: string;
  view: EditorView;
  modifiedEditor: monacoEditor.ICodeEditor | null;
  monaco: typeof import('monaco-editor') | null;
  /** Master on/off (header toggle). When false, nothing is fetched or drawn. */
  enabled: boolean;
  /** True only for a loaded, non-binary, non-large file — otherwise no blame. */
  canBlame: boolean;
}

/** Rest-on-a-line delay before blame first appears (ms). */
const HOVER_DELAY_MS = 350;
/** Editor block fade-out duration; keep in sync with the CSS animation. */
const BLOCK_FADE_MS = 340;
/** Grace period after the mouse leaves the editor before blame hides — lets the
 *  pointer travel onto the (interactive) label without it vanishing first. */
const LEAVE_GRACE_MS = 160;

/** A pixel band on the right overview-ruler strip marking the hovered commit's
 *  extent, plus a compact label. Positioned by EditorPane (top-relative). */
export interface BlameRulerMark {
  top: number;
  height: number;
  label: BlameLabel;
  /** 1-indexed inclusive line run of the hovered commit, surfaced on the card. */
  lineStart: number;
  lineEnd: number;
}

/**
 * Inline git blame for the modified editor. Fetches per-line authorship for the
 * current (cwd, filePath, view); then, on hover (after a short rest delay),
 * highlights the contiguous run of lines belonging to the hovered line's commit
 * in the editor body, and surfaces that run as a band + a compact info card on
 * the right overview-ruler strip — returned as `rulerMark`/`rulerVisible`/
 * `rulerHost` for EditorPane to position and render. The card is interactive
 * (its × disables blame); `holdLabel`/`releaseLabel` keep it shown while the
 * pointer is on it. Everything fades in/out. Blame is fetched once per view;
 * hovering only re-applies decorations — no IPC.
 */
export function useGitBlame({
  cwd,
  filePath,
  view,
  modifiedEditor,
  monaco,
  enabled,
  canBlame,
}: Args): {
  rulerMark: BlameRulerMark | null;
  rulerVisible: boolean;
  /** True only when the card moves directly between two commits (visible→visible)
   *  — drives the eased top/height slide. False on a fresh appear so the card
   *  doesn't glide in from the previous commit's position. */
  rulerSlide: boolean;
  rulerHost: HTMLElement | null;
  /** Keep blame shown while the pointer is over the label (cancels the hide). */
  holdLabel: () => void;
  /** Release the label — schedule the grace-period hide. */
  releaseLabel: () => void;
} {
  const [lines, setLines] = useState<BlameLine[]>([]);
  // `rulerMark` keeps the last geometry/label so the band + label can fade/slide
  // OUT in place; `rulerVisible` drives the in/out transition.
  const [rulerMark, setRulerMark] = useState<BlameRulerMark | null>(null);
  const [rulerVisible, setRulerVisible] = useState(false);
  const [rulerSlide, setRulerSlide] = useState(false);
  // A div inserted as the first child of Monaco's `.diffOverview` so the band
  // paints BEHIND the ruler's diff add/delete marks; null until located.
  const [rulerHost, setRulerHost] = useState<HTMLElement | null>(null);
  // Stable handles for the label's mouseenter/leave — delegate to the current
  // render effect's hide scheduling (which lives in the effect closure).
  const holdRef = useRef<() => void>(() => {});
  const releaseRef = useRef<() => void>(() => {});
  const holdLabel = useCallback(() => holdRef.current(), []);
  const releaseLabel = useCallback(() => releaseRef.current(), []);

  // Fetch blame for the current view. Keyed on the inputs that change the
  // answer; cursor movement is deliberately not a dependency.
  useEffect(() => {
    if (!enabled || !canBlame || !filePath) {
      setLines([]);
      return;
    }
    let cancelled = false;
    const ref = refForView(view);
    void window.electronAPI
      .editorBlame({ cwd, filePath, ref })
      .then((resp) => {
        if (cancelled) return;
        setLines(resp.success && resp.data ? resp.data.lines : []);
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, filePath, view, enabled, canBlame]);

  // Render: a block tint over the hovered commit's run, plus the ruler band +
  // label carrying the blame text. Hidden — faded out — when the mouse leaves.
  useEffect(() => {
    if (!modifiedEditor || !monaco || !enabled || lines.length === 0) return;

    const lineHeight = modifiedEditor.getOption(monaco.editor.EditorOption.lineHeight);
    const block = modifiedEditor.createDecorationsCollection();

    // Insert a host behind the ruler's diff marks for the band to portal into.
    // If the overview strip can't be found, EditorPane falls back to the area.
    const overview = modifiedEditor
      .getDomNode()
      ?.closest('.monaco-diff-editor')
      ?.querySelector('.diffOverview') as HTMLElement | null;
    let host: HTMLDivElement | null = null;
    if (overview) {
      host = document.createElement('div');
      host.className = 'monaco-blame-ruler-host';
      overview.insertBefore(host, overview.firstChild);
    }
    setRulerHost(host);

    // The commit run currently displayed (1-indexed, inclusive), or null when
    // hidden. Used to suppress re-renders while the mouse stays inside the run.
    let shownRun: { start: number; end: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let outTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const clearOutTimer = () => {
      if (outTimer) {
        clearTimeout(outTimer);
        outTimer = null;
      }
    };
    const paintBlock = (run: { start: number; end: number }, className: string) => {
      block.set([
        {
          range: new monaco.Range(run.start, 1, run.end, 1),
          options: { isWholeLine: true, className },
        },
      ]);
    };

    // Map a commit run to a band + label on the right overview-ruler strip. The
    // strip shows the whole file scaled into the editor's height, so this is
    // pure content→strip math (independent of scroll). Null until laid out.
    const buildMark = (run: { start: number; end: number }): BlameRulerMark | null => {
      const viewportHeight = modifiedEditor.getLayoutInfo().height;
      const scrollHeight = modifiedEditor.getScrollHeight();
      if (!scrollHeight || !viewportHeight) return null;
      const scale = Math.min(1, viewportHeight / scrollHeight);
      const top = modifiedEditor.getTopForLineNumber(run.start) * scale;
      const bottom = (modifiedEditor.getTopForLineNumber(run.end) + lineHeight) * scale;
      const blame = lines[run.start - 1];
      if (!blame) return null;
      return {
        top,
        height: Math.max(2, bottom - top),
        label: blameLabel(blame, Date.now() / 1000),
        lineStart: run.start,
        lineEnd: run.end,
      };
    };

    const hide = () => {
      clearTimer();
      if (!shownRun) return;
      const run = shownRun;
      shownRun = null;
      setRulerVisible(false); // band + label fade out, geometry retained
      // Fade the editor block out (out-animation), then drop the decoration.
      clearOutTimer();
      paintBlock(run, 'monaco-blame-block-out');
      outTimer = setTimeout(() => {
        outTimer = null;
        block.clear();
      }, BLOCK_FADE_MS);
    };

    const show = (lineNumber: number) => {
      const model = modifiedEditor.getModel();
      const blame = model ? lines[lineNumber - 1] : undefined;
      const run = blame ? contiguousBlock(lines, lineNumber) : null;
      if (!model || !blame || !run) {
        hide();
        return;
      }
      clearOutTimer(); // cancel any pending fade-out clear
      // A move between two already-shown commits should slide; a fresh appear
      // (was hidden) should snap to position, then fade in.
      const moving = shownRun !== null;
      shownRun = run;
      paintBlock(run, 'monaco-blame-block');
      const mark = buildMark(run);
      if (mark) {
        setRulerSlide(moving);
        setRulerMark(mark);
        setRulerVisible(true);
      }
    };

    // Hover-to-line with a rest delay. Moving *within* the shown commit run is a
    // no-op (it's the same commit), so it neither re-renders nor re-delays.
    // Pointing at a different line/run (re)starts the delay; the current blame,
    // if any, stays put until the new one is ready.
    const onLine = (lineNumber: number) => {
      if (shownRun && lineNumber >= shownRun.start && lineNumber <= shownRun.end) {
        clearTimer();
        return;
      }
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        show(lineNumber);
      }, HOVER_DELAY_MS);
    };

    // Hiding on mouse-leave is deferred by a grace period so the pointer can
    // travel from the code onto the interactive label without it vanishing.
    // While the pointer is actually ON the label, `overLabel` makes hover
    // authoritative — no editor event (even a late onMouseLeave) can hide it.
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;
    let overLabel = false;
    const cancelHide = () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
    };
    const scheduleHide = () => {
      if (overLabel) return; // card hover wins — never hide while on it
      clearTimer(); // cancel a pending show
      cancelHide();
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        if (!overLabel) hide();
      }, LEAVE_GRACE_MS);
    };
    // Pointer entered the label → pin the current commit: cancel the pending
    // hide AND any pending show (armed while crossing other lines en route), so
    // the block + band + card stay frozen to be clicked.
    holdRef.current = () => {
      overLabel = true;
      clearTimer();
      cancelHide();
    };
    // Pointer left the label → resume the normal grace-period hide.
    releaseRef.current = () => {
      overLabel = false;
      scheduleHide();
    };

    const moveSub = modifiedEditor.onMouseMove((e) => {
      const ln = e.target.position?.lineNumber;
      if (ln) {
        cancelHide();
        onLine(ln);
      } else {
        scheduleHide();
      }
    });
    const leaveSub = modifiedEditor.onMouseLeave(() => scheduleHide());
    // Re-sync the ruler band when the strip's geometry changes (resize, wrap
    // toggle, content height) — not on scroll, which doesn't move the band.
    const resync = () => {
      if (!shownRun) return;
      const mark = buildMark(shownRun);
      if (mark) setRulerMark(mark);
    };
    const layoutSub = modifiedEditor.onDidLayoutChange(resync);
    const sizeSub = modifiedEditor.onDidContentSizeChange(resync);

    return () => {
      clearTimer();
      clearOutTimer();
      cancelHide();
      moveSub.dispose();
      leaveSub.dispose();
      layoutSub.dispose();
      sizeSub.dispose();
      block.clear();
      host?.remove();
      setRulerHost(null);
      setRulerVisible(false);
    };
  }, [modifiedEditor, monaco, lines, enabled]);

  return { rulerMark, rulerVisible, rulerSlide, rulerHost, holdLabel, releaseLabel };
}
