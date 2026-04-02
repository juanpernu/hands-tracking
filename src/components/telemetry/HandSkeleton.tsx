import { useRef, useEffect } from 'react';
import type { HandData } from '../../types';
import type { HandPhysics } from '../../types/telemetry';

interface HandSkeletonProps {
  hands: HandData[];
  physicsData: HandPhysics[];
  workspaceWidth: number;
  workspaceHeight: number;
}

// MediaPipe landmark connections
const BONE_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm cross
  [5, 9], [9, 13], [13, 17],
];

function speedToColor(speed: number): string {
  if (speed < 2) return '#4A90D9';
  if (speed < 8) return '#27C93F';
  if (speed < 20) return '#FFBD2E';
  return '#FF5F56';
}

export function HandSkeleton({
  hands,
  physicsData,
  workspaceWidth,
  workspaceHeight,
}: HandSkeletonProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, workspaceWidth, workspaceHeight);

    hands.forEach((hand) => {
      const physics = physicsData.find((p) => p.handedness === hand.handedness);
      const landmarkPhysicsMap = new Map(
        physics?.landmarks.map((lp) => [lp.index, lp]) ?? []
      );

      // Convert normalized landmark coords to pixel coords (mirror X)
      const toPixel = (lm: { x: number; y: number }) => ({
        px: (1 - lm.x) * workspaceWidth,
        py: lm.y * workspaceHeight,
      });

      // Draw bones
      BONE_CONNECTIONS.forEach(([a, b]) => {
        const lmA = hand.landmarks[a];
        const lmB = hand.landmarks[b];
        if (!lmA || !lmB) return;

        const { px: ax, py: ay } = toPixel(lmA);
        const { px: bx, py: by } = toPixel(lmB);

        const speedA = landmarkPhysicsMap.get(a)?.speed ?? 0;
        const speedB = landmarkPhysicsMap.get(b)?.speed ?? 0;
        const avgSpeed = (speedA + speedB) / 2;

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = speedToColor(avgSpeed);
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.75;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Draw landmark circles and labels
      hand.landmarks.forEach((lm, i) => {
        const { px, py } = toPixel(lm);
        const speed = landmarkPhysicsMap.get(i)?.speed ?? 0;
        const color = speedToColor(speed);

        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Index label
        ctx.font = '9px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(String(i), px + 4, py - 4);
      });
    });
  }, [hands, physicsData, workspaceWidth, workspaceHeight]);

  return (
    <canvas
      ref={canvasRef}
      width={workspaceWidth}
      height={workspaceHeight}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1101,
      }}
    />
  );
}

export default HandSkeleton;
