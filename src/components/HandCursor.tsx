import React from 'react';
import type { GestureState } from '../types';
import { UI } from '../config';

interface HandCursorProps {
  gestureState: GestureState;
}

interface CursorStyle {
  width: number;
  height: number;
  background: string;
  border: string;
  boxShadow: string;
}

function getCursorStyle(gestureState: GestureState): CursorStyle {
  switch (gestureState) {
    case 'hovering':
      return {
        width: 28,
        height: 28,
        background: 'rgba(40, 202, 66, 0.15)',
        border: '2px solid #28CA42',
        boxShadow: '0 0 8px rgba(40, 202, 66, 0.4)',
      };
    case 'grabbing':
      return {
        width: 20,
        height: 20,
        background: '#4A90D9',
        border: '2px solid #4A90D9',
        boxShadow: '0 0 8px rgba(74, 144, 217, 0.5)',
      };
    case 'creating':
      return {
        width: 24,
        height: 24,
        background: 'rgba(255, 160, 122, 0.2)',
        border: '2px solid #FFA07A',
        boxShadow: '0 0 8px rgba(255, 160, 122, 0.4)',
      };
    case 'deleting':
      return {
        width: 24,
        height: 24,
        background: 'rgba(255, 107, 107, 0.2)',
        border: '2px solid #FF6B6B',
        boxShadow: '0 0 8px rgba(255, 107, 107, 0.4)',
      };
    case 'idle':
    default:
      return {
        width: 24,
        height: 24,
        background: 'rgba(255, 255, 255, 0.5)',
        border: '2px solid #4A90D9',
        boxShadow: 'none',
      };
  }
}

const HandCursor = React.forwardRef<HTMLDivElement, HandCursorProps>(
  ({ gestureState }, ref) => {
    const { width, height, background, border, boxShadow } = getCursorStyle(gestureState);

    return (
      <div
        ref={ref}
        style={{
          position: 'absolute',
          width,
          height,
          background,
          border,
          boxShadow,
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 1000,
          // Offset so the center of the circle tracks the hand point
          marginLeft: -width / 2,
          marginTop: -height / 2,
          // Animate visual properties only — transform must be instant
          transition: `width ${UI.TRANSITION_DURATION_MS}ms ease-out, height ${UI.TRANSITION_DURATION_MS}ms ease-out, background-color ${UI.TRANSITION_DURATION_MS}ms ease-out, margin ${UI.TRANSITION_DURATION_MS}ms ease-out, border-color ${UI.TRANSITION_DURATION_MS}ms ease-out, box-shadow ${UI.TRANSITION_DURATION_MS}ms ease-out`,
        }}
      />
    );
  }
);

HandCursor.displayName = 'HandCursor';

export default React.memo(HandCursor);
