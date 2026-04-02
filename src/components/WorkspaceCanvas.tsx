import React from 'react';
import { WORKSPACE } from '../types';

interface WorkspaceCanvasProps {
  children: React.ReactNode;
  width?: number;
  height?: number;
}

const GRID_SIZE = 24;
const GRID_COLOR = 'rgba(0,0,0,0.04)';

function buildGridBackground(): string {
  // Subtle cross-hatch grid using CSS repeating-linear-gradient
  return [
    `repeating-linear-gradient(0deg, transparent, transparent ${GRID_SIZE - 1}px, ${GRID_COLOR} ${GRID_SIZE - 1}px, ${GRID_COLOR} ${GRID_SIZE}px)`,
    `repeating-linear-gradient(90deg, transparent, transparent ${GRID_SIZE - 1}px, ${GRID_COLOR} ${GRID_SIZE - 1}px, ${GRID_COLOR} ${GRID_SIZE}px)`,
  ].join(', ');
}

export function WorkspaceCanvas({
  children,
  width = WORKSPACE.width,
  height = WORKSPACE.height,
}: WorkspaceCanvasProps) {
  const style: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    width,
    height,
    backgroundColor: '#fafafa',
    background: `${buildGridBackground()}, #fafafa`,
    flexShrink: 0,
  };

  return <div style={style}>{children}</div>;
}
