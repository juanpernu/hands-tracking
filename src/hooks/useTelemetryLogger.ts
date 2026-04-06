import { useRef, useState, useCallback } from 'react';
import type { HandData } from '../types';
import type { HandPhysics, GripState, MotionPattern } from '../types/telemetry';
import type { HandFeatureVector } from '../types/features';
import { magnitude3, dot3 } from '../utils/geometry';
import { TELEMETRY_LOGGER } from '../config';

// --- Event types that we can detect and log ---

export type TelemetryEventType =
  | 'velocity-spike'      // sudden fast movement
  | 'shake'               // rapid back-and-forth
  | 'acceleration-burst'  // sudden start from rest
  | 'clap'                // both palms converge fast
  | 'sudden-stop'         // moving fast then stopping
  | 'grip-change'         // grip state transition
  | 'motion-detected'     // swipe, circular, etc.
  | 'object-grab'         // hand grabbed a DOM object
  | 'object-move'         // DOM object being moved
  | 'object-release'      // hand released a DOM object
  | 'object-collision'    // two DOM objects collided
  | 'snapshot';           // periodic data capture

export interface TelemetryLogEntry {
  id: number;
  timestamp: number;
  type: TelemetryEventType;
  handedness: 'Left' | 'Right' | 'Both';
  description: string;
  data: {
    velocity?: number;
    acceleration?: number;
    gripType?: string;
    motionType?: string;
    palmPosition?: { x: number; y: number; z: number };
  };
}

// Per-hand tracking state for event detection
interface HandState {
  velocityHistory: number[];   // last 15 frames of speed
  directionHistory: number[];  // last 15 frames of atan2(vy, vx)
  lastGripType: string | null;
  wasMoving: boolean;
  shakeCount: number;          // direction reversals in window
  lastLogTime: number;         // debounce per event type
}


function createHandState(): HandState {
  return {
    velocityHistory: [],
    directionHistory: [],
    lastGripType: null,
    wasMoving: false,
    shakeCount: 0,
    lastLogTime: 0,
  };
}


export interface TelemetryLoggerResult {
  log: TelemetryLogEntry[];
  processFrame: (
    hands: HandData[],
    physics: HandPhysics[],
    grips: GripState[],
    motions: MotionPattern[],
    timestamp: number,
    features?: HandFeatureVector[],
  ) => void;
  addEntry: (entry: Omit<TelemetryLogEntry, 'id'>) => void;
  clearLog: () => void;
  exportLog: () => string;
  onClapRef: React.MutableRefObject<(() => void) | null>;
}

export function useTelemetryLogger(): TelemetryLoggerResult {
  const [log, setLog] = useState<TelemetryLogEntry[]>([]);
  const logRef = useRef(log);
  logRef.current = log;
  const idCounterRef = useRef(0);
  const handStatesRef = useRef<Record<string, HandState>>({
    Left: createHandState(),
    Right: createHandState(),
  });
  const lastSnapshotRef = useRef(0);
  const lastClapTimeRef = useRef(0);
  const onClapRef = useRef<(() => void) | null>(null);
  // Clap requires 2 phases: convergence (moving toward each other) then impact (sudden stop)
  const clapPhaseRef = useRef<{ converging: boolean; convergeTime: number; peakSpeed: number }>({
    converging: false,
    convergeTime: 0,
    peakSpeed: 0,
  });

  const addEntry = useCallback((entry: Omit<TelemetryLogEntry, 'id'>) => {
    const id = ++idCounterRef.current;
    setLog((prev) => {
      const next = [...prev, { ...entry, id }];
      return next.length > TELEMETRY_LOGGER.MAX_LOG_ENTRIES ? next.slice(-TELEMETRY_LOGGER.MAX_LOG_ENTRIES) : next;
    });
  }, []);

  const processFrame = useCallback((
    hands: HandData[],
    physics: HandPhysics[],
    grips: GripState[],
    motions: MotionPattern[],
    timestamp: number,
    features?: HandFeatureVector[],
  ) => {
    // --- Clap detection: two-phase ---
    // Phase 1: both hands fast + converging in X
    // Phase 2: impact = (a) both slow + palms close, OR (b) hand lost (palms occlude)
    const phase = clapPhaseRef.current;

    if (timestamp - lastClapTimeRef.current > TELEMETRY_LOGGER.CLAP_DEBOUNCE_MS) {
      if (hands.length >= 2 && physics.length >= 2) {
        const leftP = physics.find((p) => p.handedness === 'Left');
        const rightP = physics.find((p) => p.handedness === 'Right');

        if (leftP && rightP) {
          const leftSpeed = magnitude3(leftP.palmVelocity);
          const rightSpeed = magnitude3(rightP.palmVelocity);
          const converging = leftP.palmVelocity.x > 0 && rightP.palmVelocity.x < 0;
          const bothFast = leftSpeed > TELEMETRY_LOGGER.CLAP_MIN_VELOCITY && rightSpeed > TELEMETRY_LOGGER.CLAP_MIN_VELOCITY;

          // Check palm orientation — palms should be roughly facing each other for a clap
          let palmsOpposed = false;
          if (features && features.length >= 2) {
            const leftFeatures = features.find(f => f.handedness === 'Left');
            const rightFeatures = features.find(f => f.handedness === 'Right');
            if (leftFeatures && rightFeatures) {
              // Dot product of palm normals: -1 = facing each other (ideal for clap)
              const normalDot = dot3(leftFeatures.palmOrientation.normal, rightFeatures.palmOrientation.normal);
              palmsOpposed = normalDot < -0.3; // normals roughly opposing
            }
          }

          if (!phase.converging) {
            // palmsOpposed required when features available, skip check when features not available (backwards compat)
            if (bothFast && converging && (palmsOpposed || !features)) {
              phase.converging = true;
              phase.convergeTime = timestamp;
              phase.peakSpeed = Math.max(leftSpeed, rightSpeed);
            }
          } else {
            phase.peakSpeed = Math.max(phase.peakSpeed, leftSpeed, rightSpeed);
            const timeSinceConverge = timestamp - phase.convergeTime;

            // Check impact: both slowed AND palms close
            const bothSlowed = leftSpeed < TELEMETRY_LOGGER.CLAP_SLOW_THRESHOLD && rightSpeed < TELEMETRY_LOGGER.CLAP_SLOW_THRESHOLD;
            const leftHand = hands.find((h) => h.handedness === 'Left');
            const rightHand = hands.find((h) => h.handedness === 'Right');
            const palmsClose = leftHand && rightHand
              ? Math.abs(leftHand.landmarks[9].x - rightHand.landmarks[9].x) < TELEMETRY_LOGGER.CLAP_CLOSE_THRESHOLD
              : false;

            if (bothSlowed && palmsClose && timeSinceConverge < TELEMETRY_LOGGER.CLAP_TIMEOUT_MS) {
              lastClapTimeRef.current = timestamp;
              phase.converging = false;
              addEntry({
                timestamp, type: 'clap', handedness: 'Both',
                description: `CLAP! peak=${(phase.peakSpeed * 1200).toFixed(0)}px/s → stopped in ${timeSinceConverge.toFixed(0)}ms`,
                data: { velocity: phase.peakSpeed },
              });
              if (onClapRef.current) onClapRef.current();
            } else if (timeSinceConverge > 500) {
              phase.converging = false;
            }
          }
        }
      } else if (phase.converging && hands.length < 2) {
        // Phase 2b: hand lost after convergence = palms collided and occluded one hand
        const timeSinceConverge = timestamp - phase.convergeTime;
        if (timeSinceConverge < TELEMETRY_LOGGER.CLAP_OCCLUSION_MS) {
          lastClapTimeRef.current = timestamp;
          phase.converging = false;
          addEntry({
            timestamp, type: 'clap', handedness: 'Both',
            description: `CLAP! peak=${(phase.peakSpeed * 1200).toFixed(0)}px/s → hand lost in ${timeSinceConverge.toFixed(0)}ms`,
            data: { velocity: phase.peakSpeed },
          });
          if (onClapRef.current) onClapRef.current();
        } else {
          phase.converging = false;
        }
      }
    }

    // Periodic snapshot
    if (timestamp - lastSnapshotRef.current >= TELEMETRY_LOGGER.SNAPSHOT_INTERVAL_MS) {
      lastSnapshotRef.current = timestamp;
      for (let i = 0; i < physics.length; i++) {
        const p = physics[i];
        const g = grips[i];
        const m = motions[i];
        if (!p) continue;
        const speed = magnitude3(p.palmVelocity);
        addEntry({
          timestamp,
          type: 'snapshot',
          handedness: p.handedness,
          description: `${p.handedness}: v=${(speed * 1200).toFixed(1)}px/s, grip=${g?.gripType ?? '?'}, motion=${m?.type ?? 'none'}`,
          data: {
            velocity: speed,
            acceleration: p.landmarks[0] ? magnitude3(p.landmarks[0].acceleration) : 0,
            gripType: g?.gripType,
            motionType: m?.type,
            palmPosition: p.palmVelocity, // using palm velocity as positional proxy
          },
        });
      }
    }

    // Per-hand event detection
    for (let i = 0; i < physics.length; i++) {
      const p = physics[i];
      const g = grips[i];
      const m = motions[i];
      if (!p) continue;

      const hand = p.handedness;
      const state = handStatesRef.current[hand];
      if (!state) continue;

      const speed = magnitude3(p.palmVelocity);
      const accel = p.landmarks[0] ? magnitude3(p.landmarks[0].acceleration) : 0;
      const direction = Math.atan2(p.palmVelocity.y, p.palmVelocity.x);

      // Update history
      state.velocityHistory.push(speed);
      if (state.velocityHistory.length > TELEMETRY_LOGGER.HISTORY_SIZE) state.velocityHistory.shift();
      state.directionHistory.push(direction);
      if (state.directionHistory.length > TELEMETRY_LOGGER.HISTORY_SIZE) state.directionHistory.shift();

      const canLog = timestamp - state.lastLogTime > TELEMETRY_LOGGER.EVENT_DEBOUNCE_MS;

      // --- Velocity spike ---
      if (canLog && speed > TELEMETRY_LOGGER.VELOCITY_SPIKE_THRESHOLD) {
        state.lastLogTime = timestamp;
        addEntry({
          timestamp,
          type: 'velocity-spike',
          handedness: hand,
          description: `${hand} hand: velocity spike ${(speed * 1200).toFixed(0)}px/s`,
          data: { velocity: speed },
        });
      }

      // --- Shake detection (rapid direction reversals) ---
      if (state.directionHistory.length >= 6) {
        let reversals = 0;
        for (let j = 2; j < state.directionHistory.length; j++) {
          const prev = state.directionHistory[j - 1] - state.directionHistory[j - 2];
          const curr = state.directionHistory[j] - state.directionHistory[j - 1];
          if (prev * curr < 0 && Math.abs(curr) > TELEMETRY_LOGGER.SHAKE_ANGLE_THRESHOLD) reversals++;
        }
        state.shakeCount = reversals;

        if (canLog && reversals >= TELEMETRY_LOGGER.SHAKE_REVERSAL_THRESHOLD && speed > TELEMETRY_LOGGER.SHAKE_SPEED_THRESHOLD) {
          state.lastLogTime = timestamp;
          addEntry({
            timestamp,
            type: 'shake',
            handedness: hand,
            description: `${hand} hand: SHAKING detected (${reversals} reversals, ${(speed * 1200).toFixed(0)}px/s)`,
            data: { velocity: speed },
          });
        }
      }

      // --- Acceleration burst (from rest) ---
      if (canLog && accel > TELEMETRY_LOGGER.ACCELERATION_THRESHOLD && !state.wasMoving) {
        state.lastLogTime = timestamp;
        addEntry({
          timestamp,
          type: 'acceleration-burst',
          handedness: hand,
          description: `${hand} hand: acceleration burst ${(accel * 1200).toFixed(0)}px/s²`,
          data: { acceleration: accel, velocity: speed },
        });
      }

      // --- Sudden stop ---
      if (canLog && state.wasMoving && speed < TELEMETRY_LOGGER.SUDDEN_STOP_THRESHOLD) {
        state.lastLogTime = timestamp;
        addEntry({
          timestamp,
          type: 'sudden-stop',
          handedness: hand,
          description: `${hand} hand: sudden stop`,
          data: { velocity: speed },
        });
      }

      // --- Grip change ---
      if (g && g.gripType !== state.lastGripType && state.lastGripType !== null) {
        addEntry({
          timestamp,
          type: 'grip-change',
          handedness: hand,
          description: `${hand} hand: grip ${state.lastGripType} → ${g.gripType}`,
          data: { gripType: g.gripType },
        });
      }

      // --- Motion pattern detected ---
      if (canLog && m && m.type !== 'none' && m.confidence > 0.5) {
        state.lastLogTime = timestamp;
        addEntry({
          timestamp,
          type: 'motion-detected',
          handedness: hand,
          description: `${hand} hand: ${m.type}${m.swipeDirection ? ' ' + m.swipeDirection : ''} (${(m.confidence * 100).toFixed(0)}%)`,
          data: { motionType: m.type, velocity: speed },
        });
      }

      // Update state
      state.wasMoving = speed > TELEMETRY_LOGGER.MOVING_SPEED_THRESHOLD;
      if (g) state.lastGripType = g.gripType;
    }
  }, [addEntry]);

  const clearLog = useCallback(() => {
    setLog([]);
    handStatesRef.current = {
      Left: createHandState(),
      Right: createHandState(),
    };
    lastSnapshotRef.current = 0;
  }, []);

  const exportLog = useCallback(() => {
    return JSON.stringify(logRef.current, null, 2);
  }, []);

  return { log, processFrame, addEntry, clearLog, exportLog, onClapRef };
}
