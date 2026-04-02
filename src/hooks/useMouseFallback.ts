import { useEffect, useRef, useState, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { Position } from '../types';

interface UseMouseFallbackReturn {
  /** Latest mouse position as normalized 0-1 coords — read from ref, no re-renders */
  positionRef: MutableRefObject<Position>;
  /** Legacy reactive position — only updated when isGrabbing changes to minimise renders.
   *  For the RAF loop, prefer positionRef.current directly. */
  position: Position;
  isGrabbing: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Tracks mouse position (normalised to 0–1 relative to a container element)
 * and click state as a fallback when hand tracking is unavailable.
 *
 * Position is stored in a ref (zero re-renders on mousemove).
 * isGrabbing is still reactive state because it drives visual changes.
 */
export function useMouseFallback(): UseMouseFallbackReturn {
  const containerRef = useRef<HTMLDivElement>(null);

  // Position lives in a ref — the RAF loop reads it without triggering renders
  const positionRef = useRef<Position>({ x: 0, y: 0 });

  // Expose a reactive copy only so legacy consumers (e.g. snapshot in App) still work.
  // We update it lazily — only on grab state transitions to avoid unnecessary renders.
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [isGrabbing, setIsGrabbing] = useState(false);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));

    // Update ref every frame — zero re-renders
    positionRef.current = { x, y };
  }, []);

  const handleMouseDown = useCallback(() => {
    // Sync reactive position on grab start so the initial grab point is correct
    setPosition({ ...positionRef.current });
    setIsGrabbing(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsGrabbing(false);
  }, []);

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

  return { positionRef, position, isGrabbing, containerRef };
}
