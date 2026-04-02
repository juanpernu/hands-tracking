import { useRef, useEffect } from 'react';
import { TELEMETRY_VIS } from '../../config';

interface TimelineEntry {
  timestamp: number;
  gesture: string;
  velocity: number;
}

interface GestureTimelineProps {
  entries: TimelineEntry[];
  workspaceWidth: number;
}

function gestureColor(gesture: string): string {
  switch (gesture) {
    case 'idle':      return 'rgba(100,100,100,0.5)';
    case 'hovering':  return 'rgba(40,202,66,0.6)';
    case 'grabbing':  return 'rgba(74,144,217,0.7)';
    case 'creating':  return 'rgba(255,160,122,0.7)';
    case 'deleting':  return 'rgba(255,107,107,0.7)';
    default:          return 'rgba(100,100,100,0.4)';
  }
}

export function GestureTimeline({ entries, workspaceWidth }: GestureTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, workspaceWidth, TELEMETRY_VIS.TIMELINE_CANVAS_HEIGHT);

    if (entries.length === 0) return;

    const now = entries[entries.length - 1].timestamp;
    const windowStart = now - TELEMETRY_VIS.TIMELINE_WINDOW_MS;

    const toX = (t: number) => ((t - windowStart) / TELEMETRY_VIS.TIMELINE_WINDOW_MS) * workspaceWidth;

    // Draw gesture bars — each entry paints from its timestamp to the next (or now)
    entries.forEach((entry, i) => {
      const nextTimestamp = entries[i + 1]?.timestamp ?? now;
      const x = Math.max(0, toX(entry.timestamp));
      const xEnd = Math.min(workspaceWidth, toX(nextTimestamp));
      const barWidth = xEnd - x;

      if (barWidth <= 0) return;

      ctx.fillStyle = gestureColor(entry.gesture);
      ctx.fillRect(x, TELEMETRY_VIS.GESTURE_BAR_Y, barWidth, TELEMETRY_VIS.GESTURE_BAR_HEIGHT);
    });

    // Velocity spikes
    entries.forEach((entry) => {
      if (entry.velocity <= TELEMETRY_VIS.VELOCITY_SPIKE_THRESHOLD) return;

      const x = toX(entry.timestamp);
      if (x < 0 || x > workspaceWidth) return;

      ctx.fillStyle = 'rgba(255,189,46,0.9)';
      ctx.fillRect(x - 1, TELEMETRY_VIS.VELOCITY_TICK_Y, 2, TELEMETRY_VIS.VELOCITY_TICK_HEIGHT);
    });

    // Current moment line (right edge)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(workspaceWidth - 1, 0);
    ctx.lineTo(workspaceWidth - 1, TELEMETRY_VIS.TIMELINE_CANVAS_HEIGHT);
    ctx.stroke();
  }, [entries, workspaceWidth]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: workspaceWidth,
        height: TELEMETRY_VIS.TIMELINE_CANVAS_HEIGHT,
        zIndex: 1140,
        background: 'rgba(0,0,0,0.65)',
        pointerEvents: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        width={workspaceWidth}
        height={TELEMETRY_VIS.TIMELINE_CANVAS_HEIGHT}
        style={{ display: 'block' }}
      />
    </div>
  );
}

export default GestureTimeline;
