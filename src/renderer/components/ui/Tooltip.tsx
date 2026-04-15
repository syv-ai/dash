import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const PADDING = 8;

interface TooltipProps {
  content: string;
  side?: 'top' | 'bottom';
  delay?: number;
  children: React.ReactElement;
}

export function Tooltip({ content, side = 'top', delay = 150, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [effectiveSide, setEffectiveSide] = useState(side);

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      // On Windows there's no titlebar inset, so top-side tooltips near the
      // top of the viewport render off-screen. Flip to bottom in that case.
      const isWin = window.electronAPI?.getPlatform() === 'win32';
      const resolved = side === 'top' && isWin && rect.top < 40 ? 'bottom' : side;
      setEffectiveSide(resolved);
      setCoords({
        x: rect.left + rect.width / 2,
        y: resolved === 'top' ? rect.top : rect.bottom,
      });
      setVisible(true);
    }, delay);
  }, [delay, side]);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
    setCoords(null);
  }, []);

  // Ref callback: measures and clamps position before first paint
  const tooltipRefCallback = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || !coords) return;
      const ttWidth = el.offsetWidth;
      const idealLeft = coords.x - ttWidth / 2;
      const clampedLeft = Math.max(
        PADDING,
        Math.min(window.innerWidth - ttWidth - PADDING, idealLeft),
      );
      el.style.left = `${clampedLeft}px`;
      el.style.transform = effectiveSide === 'top' ? 'translateY(-100%)' : '';
      el.style.visibility = 'visible';
    },
    [coords, effectiveSide],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <>
      {React.cloneElement(children, {
        ref: triggerRef,
        onMouseEnter: show,
        onMouseLeave: hide,
        onMouseDown: hide,
      })}
      {visible &&
        coords &&
        createPortal(
          <div
            ref={tooltipRefCallback}
            className="tooltip-popup"
            style={{
              top: effectiveSide === 'top' ? coords.y - 6 : coords.y + 6,
              visibility: 'hidden',
            }}
            data-side={effectiveSide}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
