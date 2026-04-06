import type { HandData } from '../types';
import type { HandPhysics, GripState, MotionPattern } from '../types/telemetry';
import type { ActionIntent, ActionDefinition } from '../plugins/types';

export type AgentGestureType =
  | 'pinch-start'
  | 'pinch-release'
  | 'both-pinch'
  | 'both-spread'
  | 'clap'
  | 'shake'
  | 'swipe-left'
  | 'swipe-right'
  | 'swipe-up'
  | 'swipe-down'
  | 'circular'
  | 'grip-change';

export interface AgentGestureEvent {
  type: AgentGestureType;
  hands: HandData[];
  physics?: HandPhysics[];
  grip?: GripState[];
  motion?: MotionPattern;
  timestamp: number;
}

export type InterpretResult =
  | { resolved: true; intent: ActionIntent }
  | { resolved: false; reason: 'no-match' | 'ambiguous' | 'complex-sequence' };

export interface GestureMapping {
  gesture: AgentGestureType;
  action: string;
  params?: Record<string, unknown>;
}

export interface InterpretRequest {
  currentGesture: AgentGestureEvent;
  recentGestures: AgentGestureEvent[];
  availableActions: ActionDefinition[];
}

export interface AgentBridge {
  interpret(request: InterpretRequest): Promise<ActionIntent | null>;
  isAvailable(): boolean;
}

// --- Ollama Integration ---

export type OllamaResponse =
  | { type: 'silence' }
  | { type: 'action'; intent: ActionIntent }
  | { type: 'error'; message: string };

export interface OllamaStreamConfig {
  model: string;
  baseUrl: string;
  systemPrompt: string;
  keepAliveMs: number;
}
