import React from 'react';
import { gripColor } from '../../utils/colors';

interface GripIndicatorProps {
  gripConfidence: number; // 0-1
  visible: boolean;
}

const RADIUS = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ~138.2

const GripIndicator = React.forwardRef<HTMLDivElement, GripIndicatorProps>(
  ({ gripConfidence, visible }, ref) => {
    if (!visible) return null;

    const dashOffset = CIRCUMFERENCE * (1 - gripConfidence);
    const color = gripColor(gripConfidence);

    return (
      <div
        ref={ref}
        style={{
          position: 'absolute',
          pointerEvents: 'none',
          zIndex: 999,
          // Center the 48x48 SVG over the tracked point
          marginLeft: -24,
          marginTop: -24,
        }}
      >
        <svg
          width={48}
          height={48}
          viewBox="0 0 48 48"
          style={{ display: 'block', transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={24}
            cy={24}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{
              transition:
                'stroke-dashoffset 150ms ease-out, stroke 150ms ease-out',
            }}
          />
        </svg>
      </div>
    );
  }
);

GripIndicator.displayName = 'GripIndicator';

export default React.memo(GripIndicator);
