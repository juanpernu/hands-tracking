/**
 * useHandAnalysis
 *
 * Composes useHandPhysics + useGripDetection + useMotionRecognition into a
 * single hook.
 *
 * Architecture:
 *  - Raw analysis data is written every frame into refs (zero re-renders).
 *  - A separate throttled setState fires at most once every 100ms so UI
 *    components always have reasonably fresh data without causing 60fps renders.
 */

import { useRef, useState, useCallback } from 'react';
import { useHandPhysics } from './useHandPhysics';
import { useGripDetection } from './useGripDetection';
import { useMotionRecognition } from './useMotionRecognition';
import type { HandData } from '../types';
import type { HandPhysics, GripState, MotionPattern } from '../types/telemetry';

const UI_THROTTLE_MS = 100; // ~10 fps for UI state updates

export interface HandAnalysisData {
  physicsData: HandPhysics[];
  gripData: GripState[];
  motionData: MotionPattern[];
}

export interface UseHandAnalysisReturn {
  /** Reactive state for UI — updates at ~10fps */
  physicsData: HandPhysics[];
  gripData: GripState[];
  motionData: MotionPattern[];
  /** Imperative getter for RAF loop — reads from refs, no re-render */
  /** Call this every frame from the RAF loop */
  computeFrame: (hands: HandData[], timestamp: number) => HandAnalysisData;
}

export function useHandAnalysis(): UseHandAnalysisReturn {
  const computePhysics = useHandPhysics();
  const detectGrip = useGripDetection();
  const classifyMotion = useMotionRecognition();

  // Refs hold the latest raw data — updated every frame, never cause re-renders
  const physicsRef = useRef<HandPhysics[]>([]);
  const gripRef = useRef<GripState[]>([]);
  const motionRef = useRef<MotionPattern[]>([]);

  // Throttle tracking
  const lastUiUpdateRef = useRef<number>(0);

  // UI-facing state — updated at ~10fps
  const [uiPhysics, setUiPhysics] = useState<HandPhysics[]>([]);
  const [uiGrip, setUiGrip] = useState<GripState[]>([]);
  const [uiMotion, setUiMotion] = useState<MotionPattern[]>([]);

  const computeFrame = useCallback(
    (hands: HandData[], timestamp: number): HandAnalysisData => {
      const physics = computePhysics(hands, timestamp);
      const grips = detectGrip(hands, timestamp);
      const motions = physics.map((p) => classifyMotion(p, timestamp));

      // Always write to refs (every frame, no re-render)
      physicsRef.current = physics;
      gripRef.current = grips;
      motionRef.current = motions;

      // Throttled UI state update (~10fps)
      if (timestamp - lastUiUpdateRef.current >= UI_THROTTLE_MS) {
        lastUiUpdateRef.current = timestamp;
        setUiPhysics(physics);
        setUiGrip(grips);
        setUiMotion(motions);
      }

      return { physicsData: physics, gripData: grips, motionData: motions };
    },
    [computePhysics, detectGrip, classifyMotion],
  );

  return {
    physicsData: uiPhysics,
    gripData: uiGrip,
    motionData: uiMotion,
    computeFrame,
  };
}
