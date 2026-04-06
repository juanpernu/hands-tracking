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
import { useHandFeatures } from './useHandFeatures';
import type { HandData } from '../types';
import type { HandPhysics, GripState, MotionPattern } from '../types/telemetry';
import type { HandFeatureVector } from '../types/features';
import { UI } from '../config';

export interface HandAnalysisData {
  physicsData: HandPhysics[];
  gripData: GripState[];
  motionData: MotionPattern[];
  featuresData: HandFeatureVector[];
}

export interface UseHandAnalysisReturn {
  /** Reactive state for UI — updates at ~10fps */
  physicsData: HandPhysics[];
  gripData: GripState[];
  motionData: MotionPattern[];
  featuresData: HandFeatureVector[];
  /** Live grip ref — updated every frame, for latency-sensitive consumers like panel drag */
  gripRef: React.RefObject<GripState[]>;
  /** Call this every frame from the RAF loop */
  computeFrame: (hands: HandData[], timestamp: number) => HandAnalysisData;
}

export function useHandAnalysis(): UseHandAnalysisReturn {
  const computePhysics = useHandPhysics();
  const detectGrip = useGripDetection();
  const classifyMotion = useMotionRecognition();
  const computeFeatures = useHandFeatures();

  // Refs hold the latest raw data — updated every frame, never cause re-renders
  const physicsRef = useRef<HandPhysics[]>([]);
  const gripRef = useRef<GripState[]>([]);
  const motionRef = useRef<MotionPattern[]>([]);
  const featuresRef = useRef<HandFeatureVector[]>([]);

  // Throttle tracking
  const lastUiUpdateRef = useRef<number>(0);

  // UI-facing state — updated at ~10fps
  const [uiPhysics, setUiPhysics] = useState<HandPhysics[]>([]);
  const [uiGrip, setUiGrip] = useState<GripState[]>([]);
  const [uiMotion, setUiMotion] = useState<MotionPattern[]>([]);
  const [uiFeatures, setUiFeatures] = useState<HandFeatureVector[]>([]);

  const computeFrame = useCallback(
    (hands: HandData[], timestamp: number): HandAnalysisData => {
      const physics = computePhysics(hands, timestamp);
      const grips = detectGrip(hands, timestamp);
      const motions = physics.map((p) => classifyMotion(p, timestamp));

      // Compute features and enrich with gesture phase from motions
      const rawFeatures = computeFeatures(hands, timestamp);
      const features = rawFeatures.map((f, i) => ({
        ...f,
        gesturePhase: motions[i]?.gesturePhase ?? f.gesturePhase,
      }));

      // Always write to refs (every frame, no re-render)
      physicsRef.current = physics;
      gripRef.current = grips;
      motionRef.current = motions;
      featuresRef.current = features;

      // Throttled UI state update (~10fps)
      if (timestamp - lastUiUpdateRef.current >= UI.THROTTLE_MS) {
        lastUiUpdateRef.current = timestamp;
        setUiPhysics(physics);
        setUiGrip(grips);
        setUiMotion(motions);
        setUiFeatures(features);
      }

      return { physicsData: physics, gripData: grips, motionData: motions, featuresData: features };
    },
    [computePhysics, detectGrip, classifyMotion, computeFeatures],
  );

  return {
    physicsData: uiPhysics,
    gripData: uiGrip,
    motionData: uiMotion,
    featuresData: uiFeatures,
    gripRef,
    computeFrame,
  };
}
