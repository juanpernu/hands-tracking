// src/types/spatial.ts

export interface SpatialElement {
  element: Element;
  tagName: string;
  selector: string;
  rect: DOMRect;
  area: number;
  relevanceScore: number;
  isInteractive: boolean;
}

export interface SpatialStack {
  point: { x: number; y: number };
  topElement: SpatialElement | null;
  elements: SpatialElement[];
  timestamp: number;
}

export interface ElementContact {
  elementA: SpatialElement;
  elementB: SpatialElement;
  overlapArea: number;
  overlapRatioA: number;
  overlapRatioB: number;
  contactAxis: 'horizontal' | 'vertical' | 'both';
}

export interface ElementProximity {
  elementA: SpatialElement;
  elementB: SpatialElement;
  distance: number;
  direction: { x: number; y: number };
  axis: 'horizontal' | 'vertical' | 'diagonal';
}

export interface HandSpatialState {
  handedness: 'Left' | 'Right';
  stack: SpatialStack;
  hoverTarget: SpatialElement | null;
  hoverDurationMs: number;
  isOverInteractive: boolean;
  previousTarget: SpatialElement | null;
}

export interface DragSpatialFeedback {
  draggedElement: SpatialElement;
  nearbyTargets: Array<{
    target: SpatialElement;
    proximity: ElementProximity | null;
    contact: ElementContact | null;
    snapSuggestion: boolean;
  }>;
}

export type SpatialEventType =
  | 'hand-enter-element'
  | 'hand-leave-element'
  | 'hand-hover'
  | 'element-contact'
  | 'element-separate'
  | 'proximity-alert'
  | 'drag-snap';

export interface SpatialEvent {
  type: SpatialEventType;
  handedness?: 'Left' | 'Right';
  target?: string;
  detail: Record<string, unknown>;
  timestamp: number;
}

export interface SpatialTelemetryData {
  topElement: string | null;
  topElementScore: number;
  isOverInteractive: boolean;
  hoverDurationMs: number;
  elementCount: number;
}
