import { useRef, useState, useCallback } from 'react';
import type { HandData } from '../types';
import type { HandPhysics, GripState, MotionPattern } from '../types/telemetry';
import { magnitude3 } from '../utils/geometry';

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

const VELOCITY_SPIKE_THRESHOLD = 0.4;   // normalized units/sec
const SHAKE_REVERSAL_THRESHOLD = 4;     // direction changes in 15 frames = shake
const ACCELERATION_THRESHOLD = 0.3;
const SUDDEN_STOP_THRESHOLD = 0.05;
const SNAPSHOT_INTERVAL_MS = 1000;       // periodic snapshot every 1s
const EVENT_DEBOUNCE_MS = 300;
const HISTORY_SIZE = 15;
const MAX_LOG_ENTRIES = 500;

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

// Clap detection thresholds (from telemetry analysis)
const CLAP_MIN_VELOCITY = 0.4;             // both hands must be moving fast
const CLAP_DEBOUNCE_MS = 1500;             // prevent double-detection

export interface TelemetryLoggerResult {
  log: TelemetryLogEntry[];
  processFrame: (
    hands: HandData[],
    physics: HandPhysics[],
    grips: GripState[],
    motions: MotionPattern[],
    timestamp: number,
  ) => void;
  addEntry: (entry: Omit<TelemetryLogEntry, 'id'>) => void;
  clearLog: () => void;
  exportLog: () => string;
  onClapRef: React.MutableRefObject<(() => void) | null>;
}

export function useTelemetryLogger(): TelemetryLoggerResult {
  const [log, setLog] = useState<TelemetryLogEntry[]>([]);
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
      return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
    });
  }, []);

  const processFrame = useCallback((
    hands: HandData[],
    physics: HandPhysics[],
    grips: GripState[],
    motions: MotionPattern[],
    timestamp: number,
  ) => {
    // --- Clap detection: two-phase ---
    // Phase 1: both hands fast + converging in X
    // Phase 2: impact = (a) both slow + palms close, OR (b) hand lost (palms occlude)
    const phase = clapPhaseRef.current;

    if (timestamp - lastClapTimeRef.current > CLAP_DEBOUNCE_MS) {
      if (hands.length >= 2 && physics.length >= 2) {
        const leftP = physics.find((p) => p.handedness === 'Left');
        const rightP = physics.find((p) => p.handedness === 'Right');

        if (leftP && rightP) {
          const leftSpeed = magnitude3(leftP.palmVelocity);
          const rightSpeed = magnitude3(rightP.palmVelocity);
          const converging =
            (leftP.palmVelocity.x > 0 && rightP.palmVelocity.x < 0) ||
            (leftP.palmVelocity.x < 0 && rightP.palmVelocity.x > 0);
          const bothFast = leftSpeed > CLAP_MIN_VELOCITY && rightSpeed > CLAP_MIN_VELOCITY;

          if (!phase.converging) {
            if (bothFast && converging) {
              phase.converging = true;
              phase.convergeTime = timestamp;
              phase.peakSpeed = Math.max(leftSpeed, rightSpeed);
            }
          } else {
            phase.peakSpeed = Math.max(phase.peakSpeed, leftSpeed, rightSpeed);
            const timeSinceConverge = timestamp - phase.convergeTime;

            // Check impact: both slowed AND palms close
            const bothSlowed = leftSpeed < 0.15 && rightSpeed < 0.15;
            const leftHand = hands.find((h) => h.handedness === 'Left');
            const rightHand = hands.find((h) => h.handedness === 'Right');
            const palmsClose = leftHand && rightHand
              ? Math.abs(leftHand.landmarks[9].x - rightHand.landmarks[9].x) < 0.15
              : false;

            if (bothSlowed && palmsClose && timeSinceConverge < 500) {
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
        if (timeSinceConverge < 400) {
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
    if (timestamp - lastSnapshotRef.current >= SNAPSHOT_INTERVAL_MS) {
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
      if (state.velocityHistory.length > HISTORY_SIZE) state.velocityHistory.shift();
      state.directionHistory.push(direction);
      if (state.directionHistory.length > HISTORY_SIZE) state.directionHistory.shift();

      const canLog = timestamp - state.lastLogTime > EVENT_DEBOUNCE_MS;

      // --- Velocity spike ---
      if (canLog && speed > VELOCITY_SPIKE_THRESHOLD) {
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
          if (prev * curr < 0 && Math.abs(curr) > 0.3) reversals++;
        }
        state.shakeCount = reversals;

        if (canLog && reversals >= SHAKE_REVERSAL_THRESHOLD && speed > 0.15) {
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
      if (canLog && accel > ACCELERATION_THRESHOLD && !state.wasMoving) {
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
      if (canLog && state.wasMoving && speed < SUDDEN_STOP_THRESHOLD) {
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
      state.wasMoving = speed > 0.1;
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
    return JSON.stringify(log, null, 2);
  }, [log]);

  return { log, processFrame, addEntry, clearLog, exportLog, onClapRef };
}
