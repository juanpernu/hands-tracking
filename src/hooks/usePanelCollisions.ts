import { useRef, useCallback } from 'react';
import { COLLISION } from '../config';

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

    // Push other panels out of the way (cascade up to 3 passes)
    const panelIds = Array.from(panelsRef.current.keys());
    for (let pass = 0; pass < COLLISION.ITERATIONS; pass++) {
      let hadOverlap = false;

      for (let i = 0; i < panelIds.length; i++) {
        for (let j = i + 1; j < panelIds.length; j++) {
          const aId = panelIds[i];
          const bId = panelIds[j];
          const a = panelsRef.current.get(aId)!;
          const b = panelsRef.current.get(bId)!;

          const aw = a.el.offsetWidth;
          const ah = a.el.offsetHeight;
          const bw = b.el.offsetWidth;
          const bh = b.el.offsetHeight;

          // AABB overlap calculation
          const overlapX = Math.min(a.x + aw, b.x + bw) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + ah, b.y + bh) - Math.max(a.y, b.y);

          if (overlapX > 0 && overlapY > 0) {
            hadOverlap = true;

            // Determine which panel to push (never push the one being dragged)
            const [pushId, pushed, pusher, pusherW, pusherH, pushedW, pushedH] =
              aId === id
                ? [bId, b, a, aw, ah, bw, bh]
                : [aId, a, b, bw, bh, aw, ah];

            // Push along smallest overlap axis
            const centerPusherX = pusher.x + pusherW / 2;
            const centerPushedX = pushed.x + pushedW / 2;
            const centerPusherY = pusher.y + pusherH / 2;
            const centerPushedY = pushed.y + pushedH / 2;

            if (overlapX < overlapY) {
              // Push horizontally
              if (centerPusherX < centerPushedX) {
                pushed.x = pusher.x + pusherW + COLLISION.PANEL_GAP;
              } else {
                pushed.x = pusher.x - pushedW - COLLISION.PANEL_GAP;
              }
            } else {
              // Push vertically
              if (centerPusherY < centerPushedY) {
                pushed.y = pusher.y + pusherH + COLLISION.PANEL_GAP;
              } else {
                pushed.y = pusher.y - pushedH - COLLISION.PANEL_GAP;
              }
            }

            // Clamp pushed panel to screen bounds
            pushed.x = Math.max(0, Math.min(pushed.x, window.innerWidth - pushedW));
            pushed.y = Math.max(0, Math.min(pushed.y, window.innerHeight - pushedH));

            // Apply to DOM immediately for responsiveness
            pushed.el.style.left = `${pushed.x}px`;
            pushed.el.style.top = `${pushed.y}px`;
          }
        }
      }

      if (!hadOverlap) break;
    }

    return { x, y };
  }, []);

  return { register, unregister, updatePosition };
}
