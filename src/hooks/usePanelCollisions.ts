import { useRef, useCallback } from 'react';

export interface PanelRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelCollisionManager {
  register: (id: string, el: HTMLDivElement) => void;
  unregister: (id: string) => void;
  updatePosition: (id: string, x: number, y: number) => { x: number; y: number };
}

export function usePanelCollisions(): PanelCollisionManager {
  const panelsRef = useRef<Map<string, { el: HTMLDivElement; x: number; y: number }>>(new Map());

  const register = useCallback((id: string, el: HTMLDivElement) => {
    panelsRef.current.set(id, { el, x: 0, y: 0 });
  }, []);

  const unregister = useCallback((id: string) => {
    panelsRef.current.delete(id);
  }, []);

  const updatePosition = useCallback((id: string, newX: number, newY: number): { x: number; y: number } => {
    const panel = panelsRef.current.get(id);
    if (!panel) return { x: newX, y: newY };

    const pw = panel.el.offsetWidth;
    const ph = panel.el.offsetHeight;

    // Clamp to screen
    let x = Math.max(0, Math.min(newX, window.innerWidth - pw));
    let y = Math.max(0, Math.min(newY, window.innerHeight - ph));

    // Update our position
    panel.x = x;
    panel.y = y;

    // Push other panels out of the way
    for (const [otherId, other] of panelsRef.current) {
      if (otherId === id) continue;

      const ow = other.el.offsetWidth;
      const oh = other.el.offsetHeight;

      // Check overlap
      if (x < other.x + ow && x + pw > other.x &&
          y < other.y + oh && y + ph > other.y) {
        // Calculate overlap on each axis
        const overlapX = Math.min(x + pw - other.x, other.x + ow - x);
        const overlapY = Math.min(y + ph - other.y, other.y + oh - y);

        // Push along smallest overlap axis
        const centerX = x + pw / 2;
        const otherCenterX = other.x + ow / 2;
        const centerY = y + ph / 2;
        const otherCenterY = other.y + oh / 2;

        if (overlapX < overlapY) {
          // Push horizontally
          if (centerX < otherCenterX) {
            other.x = x + pw + 4; // 4px gap
          } else {
            other.x = x - ow - 4;
          }
        } else {
          // Push vertically
          if (centerY < otherCenterY) {
            other.y = y + ph + 4;
          } else {
            other.y = y - oh - 4;
          }
        }

        // Clamp pushed panel
        other.x = Math.max(0, Math.min(other.x, window.innerWidth - ow));
        other.y = Math.max(0, Math.min(other.y, window.innerHeight - oh));

        // Apply to DOM immediately for responsiveness
        other.el.style.left = `${other.x}px`;
        other.el.style.top = `${other.y}px`;
      }
    }

    return { x, y };
  }, []);

  return { register, unregister, updatePosition };
}
