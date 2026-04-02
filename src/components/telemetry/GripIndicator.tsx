import React from 'react';
import { gripColor } from '../../utils/colors';
import { TELEMETRY_VIS } from '../../config';

interface GripIndicatorProps {
  gripConfidence: number; // 0-1
  visible: boolean;
}

const CIRCUMFERENCE = 2 * Math.PI * TELEMETRY_VIS.GRIP_INDICATOR_RADIUS;
const GRIP_CENTER = TELEMETRY_VIS.GRIP_INDICATOR_RADIUS + 2;
const GRIP_SVG_SIZE = GRIP_CENTER * 2;

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
          // Center the SVG over the tracked point
          marginLeft: -GRIP_CENTER,
          marginTop: -GRIP_CENTER,
        }}
      >
        <svg
          width={GRIP_SVG_SIZE}
          height={GRIP_SVG_SIZE}
          viewBox={`0 0 ${GRIP_SVG_SIZE} ${GRIP_SVG_SIZE}`}
          style={{ display: 'block', transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={GRIP_CENTER}
            cy={GRIP_CENTER}
            r={TELEMETRY_VIS.GRIP_INDICATOR_RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={TELEMETRY_VIS.GRIP_INDICATOR_STROKE}
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
