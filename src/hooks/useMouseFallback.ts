import { useEffect, useRef, useState, useCallback } from 'react';
import type { Position } from '../types';

interface MouseFallbackState {
  position: Position;
  isGrabbing: boolean;
}

interface UseMouseFallbackReturn extends MouseFallbackState {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Tracks mouse position (normalised to 0–1 relative to a container element)
 * and click state as a fallback when hand tracking is unavailable.
 *
 * Returned `position` values mirror the coordinate space used by MediaPipe
 * landmarks — x and y are each in the [0, 1] range.
 */
export function useMouseFallback(): UseMouseFallbackReturn {
  const containerRef = useRef<HTMLDivElement>(null);

  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [isGrabbing, setIsGrabbing] = useState(false);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();

    // Clamp to [0, 1] so consumers always receive in-bounds values.
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));

    setPosition({ x, y });
  }, []);

  const handleMouseDown = useCallback(() => {
    setIsGrabbing(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsGrabbing(false);
  }, []);

  // Also release grab if the pointer leaves the window while held down.
  const handleMouseLeave = useCallback(() => {
    setIsGrabbing(false);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [handleMouseMove, handleMouseDown, handleMouseUp, handleMouseLeave]);

  return { position, isGrabbing, containerRef };
}
