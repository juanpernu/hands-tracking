import { useRef, useState, useCallback, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';

interface HandCursorInput {
  x: number;
  y: number;
  isGrabbing: boolean;
}

interface DraggablePanelProps {
  children: ReactNode;
  initialX: number;
  initialY: number;
  handCursors?: HandCursorInput[];
}

function clampPosition(
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
): { x: number; y: number } {
  const maxX = window.innerWidth - panelWidth;
  const maxY = window.innerHeight - panelHeight;
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

export function DraggablePanel({
  children,
  initialX,
  initialY,
  handCursors = [],
}: DraggablePanelProps) {
  const [position, setPosition] = useState(() =>
    clampPosition(initialX, initialY, 320, 240),
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const activeHandIndexRef = useRef<number | null>(null);
  const wasGrabbingRef = useRef<boolean[]>([]);

  // Keep the latest handCursors in a ref so the effect doesn't re-fire every frame.
  // The effect only needs to run when position changes (for hit-test) or on mount.
  const handCursorsRef = useRef<HandCursorInput[]>(handCursors);
  handCursorsRef.current = handCursors;

  // Stable ref for position so the hand-cursor effect can read without being
  // a dep (which would cause the effect to re-run every render).
  const positionRef = useRef(position);
  positionRef.current = position;

  // Helper to set position with clamping
  const setClampedPosition = useCallback((x: number, y: number) => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 320;
    const h = el?.offsetHeight ?? 240;
    setPosition(clampPosition(x, y, w, h));
  }, []);

  // Mouse drag
  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    const pos = positionRef.current;
    dragOffsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
  }, []);

  useEffect(() => {
    if (!isDragging || activeHandIndexRef.current !== null) return;

    const handleMouseMove = (e: MouseEvent) => {
      setClampedPosition(
        e.clientX - dragOffsetRef.current.x,
        e.clientY - dragOffsetRef.current.y,
      );
    };
    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, setClampedPosition]);

  // Hand cursor drag — runs on RAF via a stable interval, reading from refs.
  // Decoupled from handCursors prop changes to avoid firing every frame.
  useEffect(() => {
    let rafId: number;

    function tick() {
      const cursors = handCursorsRef.current;
      const el = panelRef.current;
      if (!el) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const pw = el.offsetWidth;
      const ph = el.offsetHeight;
      const pos = positionRef.current;

      for (let i = 0; i < cursors.length; i++) {
        const cursor = cursors[i];
        const wasGrabbing = wasGrabbingRef.current[i] ?? false;

        if (cursor.isGrabbing && !wasGrabbing) {
          if (
            activeHandIndexRef.current === null &&
            cursor.x >= pos.x - 10 && cursor.x <= pos.x + pw + 10 &&
            cursor.y >= pos.y - 10 && cursor.y <= pos.y + ph + 10
          ) {
            activeHandIndexRef.current = i;
            setIsDragging(true);
            dragOffsetRef.current = {
              x: cursor.x - pos.x,
              y: cursor.y - pos.y,
            };
          }
        }

        if (!cursor.isGrabbing && wasGrabbing && activeHandIndexRef.current === i) {
          activeHandIndexRef.current = null;
          setIsDragging(false);
        }
      }

      if (activeHandIndexRef.current !== null) {
        if (activeHandIndexRef.current >= cursors.length) {
          activeHandIndexRef.current = null;
          setIsDragging(false);
        } else {
          const activeCursor = cursors[activeHandIndexRef.current];
          if (activeCursor?.isGrabbing) {
            setClampedPosition(
              activeCursor.x - dragOffsetRef.current.x,
              activeCursor.y - dragOffsetRef.current.y,
            );
          } else {
            activeHandIndexRef.current = null;
            setIsDragging(false);
          }
        }
      }

      wasGrabbingRef.current = cursors.map((c) => c.isGrabbing);
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // Only setClampedPosition is a dep — it's stable (useCallback with [])
  }, [setClampedPosition]);

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        zIndex: 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        outline: isDragging ? '2px solid rgba(74, 144, 217, 0.5)' : 'none',
        transition: isDragging ? 'none' : 'outline 200ms ease',
      }}
      onMouseDown={handleMouseDown}
    >
      {children}
    </div>
  );
}
