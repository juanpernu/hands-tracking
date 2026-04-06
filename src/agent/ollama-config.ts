import type { AgentGestureEvent, ActionDefinition } from './types';
import type { HandSpatialState } from '../types/spatial';

const SYSTEM_PROMPT_TEMPLATE = `You are a real-time gesture interpreter for a hand-tracking application.

You observe a continuous stream of hand gestures and spatial context.
Most gestures are routine — respond with "_" (single underscore) for those.
Only respond with a JSON action when you detect a meaningful pattern that
the simple gesture mappings cannot handle.

Respond with "_" when:
- The gesture is a common single gesture (pinch, swipe, etc.)
- The gesture is ambiguous and needs more context
- Nothing actionable is happening

Respond with JSON when you detect:
- A multi-gesture sequence that maps to a specific action
- A gesture + spatial context combination (e.g., sustained hover + pinch = click)
- A complex pattern the exact-match system would miss

JSON format: {"plugin":"<plugin-id>","action":"<action-id>"}

Available actions:
{{ACTIONS_LIST}}

Rules:
- NEVER explain. NEVER add text. Only "_" or valid JSON.
- One response per message. No multi-line.
- You are an observer. Most of the time, stay silent with "_".`;

export function buildSystemPrompt(actions: ActionDefinition[]): string {
  const actionsList = actions
    .map((a) => `- ${a.id}: ${a.description}`)
    .join('\n');
  return SYSTEM_PROMPT_TEMPLATE.replace('{{ACTIONS_LIST}}', actionsList);
}

export function formatGestureMessage(
  gesture: AgentGestureEvent,
  spatial?: { left: HandSpatialState | null; right: HandSpatialState | null },
): string {
  const parts: string[] = [];

  // Gesture type
  parts.push(`G:${gesture.type}`);

  // Velocity (from first hand's physics if available)
  if (gesture.physics && gesture.physics.length > 0) {
    const p = gesture.physics[0];
    parts.push(`V:${p.palmVelocity.x.toFixed(1)},${p.palmVelocity.y.toFixed(1)}`);
  }

  // Grip type
  if (gesture.grip && gesture.grip.length > 0) {
    parts.push(`GR:${gesture.grip[0].gripType}`);
  }

  // Spatial context — which DOM element is under the primary hand
  if (spatial) {
    const hand = spatial.right ?? spatial.left;
    if (hand?.hoverTarget) {
      const t = hand.hoverTarget;
      const dur = (hand.hoverDurationMs / 1000).toFixed(1);
      parts.push(`SP:${t.selector},${t.relevanceScore},${dur}s`);
    } else {
      parts.push('SP:none');
    }
  }

  return parts.join('|');
}
