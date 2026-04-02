import { useRef, useState, useCallback, useEffect } from 'react';

interface HandCursorInput {
  x: number;
  y: number;
  isGrabbing: boolean;
}

interface DraggablePanelProps {
  children: React.ReactNode;
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

  // Helper to set position with clamping
  const setClampedPosition = useCallback((x: number, y: number) => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 320;
    const h = el?.offsetHeight ?? 240;
    setPosition(clampPosition(x, y, w, h));
  }, []);

  // Mouse drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragOffsetRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position]);

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

  // Hand cursor drag
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const pw = el.offsetWidth;
    const ph = el.offsetHeight;

    for (let i = 0; i < handCursors.length; i++) {
      const cursor = handCursors[i];
      const wasGrabbing = wasGrabbingRef.current[i] ?? false;

      if (cursor.isGrabbing && !wasGrabbing) {
        if (
          activeHandIndexRef.current === null &&
          cursor.x >= position.x - 10 && cursor.x <= position.x + pw + 10 &&
          cursor.y >= position.y - 10 && cursor.y <= position.y + ph + 10
        ) {
          activeHandIndexRef.current = i;
          setIsDragging(true);
          dragOffsetRef.current = {
            x: cursor.x - position.x,
            y: cursor.y - position.y,
          };
        }
      }

      if (!cursor.isGrabbing && wasGrabbing && activeHandIndexRef.current === i) {
        activeHandIndexRef.current = null;
        setIsDragging(false);
      }
    }

    if (activeHandIndexRef.current !== null) {
      const activeCursor = handCursors[activeHandIndexRef.current];
      if (activeCursor?.isGrabbing) {
        setClampedPosition(
          activeCursor.x - dragOffsetRef.current.x,
          activeCursor.y - dragOffsetRef.current.y,
        );
      }
    }

    wasGrabbingRef.current = handCursors.map((c) => c.isGrabbing);
  }, [handCursors, position, setClampedPosition]);

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
