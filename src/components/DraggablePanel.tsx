import { useRef, useState, useCallback, useEffect } from 'react';
import type { PanelCollisionManager } from '../hooks/usePanelCollisions';

interface HandCursorInput {
  x: number;
  y: number;
  isGrabbing: boolean;
}

interface DraggablePanelProps {
  children: React.ReactNode;
  id: string;
  initialX: number;
  initialY: number;
  handCursors?: HandCursorInput[];
  collisionManager?: PanelCollisionManager;
}

export function DraggablePanel({
  children,
  id,
  initialX,
  initialY,
  handCursors = [],
  collisionManager,
}: DraggablePanelProps) {
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const activeHandIndexRef = useRef<number | null>(null);
  const wasGrabbingRef = useRef<boolean[]>([]);
  const dragStartTimeRef = useRef(0);
  const MAX_DRAG_MS = 5000; // auto-release after 5 seconds

  // Register with collision manager
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !collisionManager) return;
    collisionManager.register(id, el);
    return () => collisionManager.unregister(id);
  }, [id, collisionManager]);

  // Move with collision resolution
  const moveTo = useCallback((x: number, y: number) => {
    if (collisionManager) {
      const resolved = collisionManager.updatePosition(id, x, y);
      setPosition(resolved);
    } else {
      const w = panelRef.current?.offsetWidth ?? 320;
      const h = panelRef.current?.offsetHeight ?? 240;
      setPosition({
        x: Math.max(0, Math.min(x, window.innerWidth - w)),
        y: Math.max(0, Math.min(y, window.innerHeight - h)),
      });
    }
  }, [id, collisionManager]);

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
      moveTo(e.clientX - dragOffsetRef.current.x, e.clientY - dragOffsetRef.current.y);
    };
    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, moveTo]);

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
          dragStartTimeRef.current = performance.now();
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
      // Auto-release safety: prevent stuck drag
      if (performance.now() - dragStartTimeRef.current > MAX_DRAG_MS) {
        activeHandIndexRef.current = null;
        setIsDragging(false);
      } else {
        const activeCursor = handCursors[activeHandIndexRef.current];
        if (activeCursor?.isGrabbing) {
          moveTo(activeCursor.x - dragOffsetRef.current.x, activeCursor.y - dragOffsetRef.current.y);
        }
      }
    }

    wasGrabbingRef.current = handCursors.map((c) => c.isGrabbing);
  }, [handCursors, position, moveTo]);

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
