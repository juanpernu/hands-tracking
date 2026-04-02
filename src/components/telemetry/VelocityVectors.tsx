import { useRef, useEffect } from 'react';
import type { HandData } from '../../types';
import type { HandPhysics } from '../../types/telemetry';
import { speedToColor } from '../../utils/colors';

interface VelocityVectorsProps {
  hands: HandData[];
  physicsData: HandPhysics[];
  workspaceWidth: number;
  workspaceHeight: number;
}

const FINGERTIP_INDICES = [4, 8, 12, 16, 20];
const MAX_ARROW_LENGTH = 60;
const ARROWHEAD_BASE = 8;
const ARROWHEAD_DEPTH = 12;

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  angle: number,
  length: number,
  color: string
) {
  const toX = fromX + Math.cos(angle) * length;
  const toY = fromY + Math.sin(angle) * length;

  // Shaft
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Arrowhead — filled triangle at tip
  const halfBase = ARROWHEAD_BASE / 2;
  const perpAngle = angle + Math.PI / 2;

  // Base center is ARROWHEAD_DEPTH back from tip
  const baseCenterX = toX - Math.cos(angle) * ARROWHEAD_DEPTH;
  const baseCenterY = toY - Math.sin(angle) * ARROWHEAD_DEPTH;

  const p1x = toX;
  const p1y = toY;
  const p2x = baseCenterX + Math.cos(perpAngle) * halfBase;
  const p2y = baseCenterY + Math.sin(perpAngle) * halfBase;
  const p3x = baseCenterX - Math.cos(perpAngle) * halfBase;
  const p3y = baseCenterY - Math.sin(perpAngle) * halfBase;

  ctx.beginPath();
  ctx.moveTo(p1x, p1y);
  ctx.lineTo(p2x, p2y);
  ctx.lineTo(p3x, p3y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function VelocityVectors({
  hands,
  physicsData,
  workspaceWidth,
  workspaceHeight,
}: VelocityVectorsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, workspaceWidth, workspaceHeight);

    hands.forEach((hand) => {
      const physics = physicsData.find((p) => p.handedness === hand.handedness);
      if (!physics) return;

      const landmarkPhysicsMap = new Map(
        physics.landmarks.map((lp) => [lp.index, lp])
      );

      FINGERTIP_INDICES.forEach((tipIndex) => {
        const lm = hand.landmarks[tipIndex];
        const lp = landmarkPhysicsMap.get(tipIndex);
        if (!lm || !lp) return;

        const speed = lp.speed;
        if (speed < 1) return;

        const px = (1 - lm.x) * workspaceWidth;
        const py = lm.y * workspaceHeight;

        // Mirror X axis for velocity direction
        const angle = Math.atan2(lp.velocity.y, -lp.velocity.x);
        const arrowLength = Math.min(speed * 4, MAX_ARROW_LENGTH);
        const color = speedToColor(speed);

        drawArrow(ctx, px, py, angle, arrowLength, color);
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
        zIndex: 1102,
      }}
    />
  );
}

export default VelocityVectors;
