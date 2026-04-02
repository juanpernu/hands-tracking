import React from 'react';
import type { DraggableObjectData } from '../types';

interface DraggableObjectProps extends DraggableObjectData {
  isHovered: boolean;
  isGrabbed: boolean;
}

function getStateStyles(
  isHovered: boolean,
  isGrabbed: boolean,
): Pick<React.CSSProperties, 'transform' | 'boxShadow' | 'zIndex'> {
  if (isGrabbed) {
    return {
      transform: 'scale(1.05)',
      boxShadow: '0 0 0 3px rgba(74, 144, 217, 0.8), 0 0 16px rgba(74, 144, 217, 0.4), 0 4px 16px rgba(0,0,0,0.3)',
      zIndex: 1,
    };
  }
  if (isHovered) {
    return {
      transform: 'scale(1.02)',
      boxShadow: '0 3px 12px rgba(0,0,0,0.2)',
      zIndex: 1,
    };
  }
  return {
    transform: 'scale(1)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    zIndex: 1,
  };
}

export const DraggableObject = React.memo(function DraggableObject({
  x,
  y,
  width,
  height,
  color,
  isHovered,
  isGrabbed,
}: DraggableObjectProps) {
  const stateStyles = getStateStyles(isHovered, isGrabbed);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    width,
    height,
    backgroundColor: color,
    borderRadius: 8,
    transition:
      'transform 150ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: isGrabbed ? 'grabbing' : 'grab',
    ...stateStyles,
  };

  return <div style={style} />;
});
