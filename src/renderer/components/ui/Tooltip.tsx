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
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        x: rect.left + rect.width / 2,
        y: side === 'top' ? rect.top : rect.bottom,
      });
      setVisible(true);
    }, delay);
  }, [delay, side]);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
    setCoords(null);
  }, []);

  // Clamp tooltip within viewport after render
  useEffect(() => {
    if (!visible || !coords || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const ttRect = el.getBoundingClientRect();

    // Clamp horizontal: keep within viewport with padding
    const minLeft = PADDING;
    const maxLeft = window.innerWidth - ttRect.width - PADDING;
    const idealLeft = coords.x - ttRect.width / 2;
    const clampedLeft = Math.max(minLeft, Math.min(maxLeft, idealLeft));

    el.style.left = `${clampedLeft}px`;
    el.style.transform = side === 'top' ? 'translateY(-100%)' : '';
  }, [visible, coords, side]);

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
            ref={tooltipRef}
            className="tooltip-popup"
            style={{
              left: coords.x,
              top: side === 'top' ? coords.y - 6 : coords.y + 6,
              transform: side === 'top' ? 'translateX(-50%) translateY(-100%)' : 'translateX(-50%)',
            }}
            data-side={side}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
