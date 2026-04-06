export interface Position {
  x: number;
  y: number;
}

export interface DraggableObjectData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  enlarged?: boolean;
}

export type GestureState = 'idle' | 'hovering' | 'grabbing' | 'creating' | 'deleting';

export interface HandData {
  landmarks: Landmark[];
  handedness: 'Left' | 'Right';
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface CursorState {
  position: Position;
  gestureState: GestureState;
}

export const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F',
] as const;

