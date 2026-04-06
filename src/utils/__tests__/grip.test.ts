import { computeFingerCurl, classifyGrip } from '../grip';
import type { Landmark } from '../../types/index';

/**
 * Helper: build a minimal 21-landmark array with zeros, then override specific ones.
 */
function makeLandmarks(overrides: Partial<Record<number, Landmark>> = {}): Landmark[] {
  // Default landmarks with realistic spread so fingertips are NOT close together.
  // This prevents the pinch proximity check from false-matching in non-pinch tests.
  const lm: Landmark[] = Array.from({ length: 21 }, (_, i) => ({
    x: (i % 5) * 0.1,     // spread across X
    y: Math.floor(i / 5) * 0.1, // spread across Y
    z: 0,
  }));
  // Ensure thumb(4), index(8), middle(12) tips are well separated
  lm[4] = { x: 0.0, y: 0.2, z: 0 };  // thumb tip
  lm[8] = { x: 0.3, y: 0.4, z: 0 };  // index tip
  lm[12] = { x: 0.5, y: 0.5, z: 0 }; // middle tip
  for (const [idx, val] of Object.entries(overrides)) {
    lm[Number(idx)] = val!;
  }
  return lm;
}

// ---------------------------------------------------------------------------
// computeFingerCurl
// ---------------------------------------------------------------------------
describe('computeFingerCurl', () => {
  it('returns ~0 for a straight finger (MCP-PIP-TIP collinear)', () => {
    // Straight line along X axis: MCP at 0, PIP at 1, TIP at 2
    const landmarks = makeLandmarks({
      6: { x: 0, y: 0, z: 0 },  // MCP
      7: { x: 1, y: 0, z: 0 },  // PIP
      8: { x: 2, y: 0, z: 0 },  // TIP
    });
    // bone1 = normalize(MCP - PIP) = (-1, 0, 0)
    // bone2 = normalize(TIP - PIP) = (1, 0, 0)
    // dot = -1, angle = PI, curl = 1 - PI/PI = 0
    const curl = computeFingerCurl(landmarks, 6, 7, 8);
    expect(curl).toBeCloseTo(0, 1);
  });

  it('returns ~1 for a fully bent finger (TIP folded back onto MCP)', () => {
    // MCP and TIP at same position relative to PIP, both on same side
    const landmarks = makeLandmarks({
      6: { x: 0, y: 1, z: 0 },  // MCP
      7: { x: 0, y: 0, z: 0 },  // PIP
      8: { x: 0, y: 1, z: 0 },  // TIP (same as MCP)
    });
    // bone1 = normalize(MCP - PIP) = (0, 1, 0)
    // bone2 = normalize(TIP - PIP) = (0, 1, 0)
    // dot = 1, angle = 0, curl = 1 - 0/PI = 1
    const curl = computeFingerCurl(landmarks, 6, 7, 8);
    expect(curl).toBeCloseTo(1, 1);
  });

  it('returns ~0.5 for a right-angle bend', () => {
    // MCP straight up from PIP, TIP straight right from PIP = 90 degrees
    const landmarks = makeLandmarks({
      6: { x: 0, y: 1, z: 0 },  // MCP (up from PIP)
      7: { x: 0, y: 0, z: 0 },  // PIP
      8: { x: 1, y: 0, z: 0 },  // TIP (right from PIP)
    });
    // bone1 = (0, 1, 0), bone2 = (1, 0, 0)
    // dot = 0, angle = PI/2, curl = 1 - 0.5 = 0.5
    const curl = computeFingerCurl(landmarks, 6, 7, 8);
    expect(curl).toBeCloseTo(0.5, 1);
  });

  it('returns 0 for degenerate input (missing landmarks)', () => {
    const landmarks: Landmark[] = [];
    const curl = computeFingerCurl(landmarks, 6, 7, 8);
    expect(curl).toBe(0);
  });

  it('returns 0.5 when PIP and MCP are at the same position (zero-length bone)', () => {
    const landmarks = makeLandmarks({
      6: { x: 0, y: 0, z: 0 },  // MCP same as PIP
      7: { x: 0, y: 0, z: 0 },  // PIP
      8: { x: 1, y: 0, z: 0 },  // TIP
    });
    // normalize3 of zero vector returns (0,0,0), dot3 = 0, acos(0) = PI/2
    // curl = 1 - (PI/2)/PI = 0.5
    const curl = computeFingerCurl(landmarks, 6, 7, 8);
    expect(curl).toBeCloseTo(0.5, 1);
  });
});

// ---------------------------------------------------------------------------
// classifyGrip
// ---------------------------------------------------------------------------
describe('classifyGrip', () => {
  it('returns "fist" when all fingers are curled > 0.7', () => {
    const curls: [number, number, number, number, number] = [0.8, 0.9, 0.85, 0.75, 0.8];
    const landmarks = makeLandmarks();
    expect(classifyGrip(curls, landmarks)).toBe('fist');
  });

  it('returns "open" when all fingers are extended < 0.3', () => {
    const curls: [number, number, number, number, number] = [0.1, 0.2, 0.15, 0.1, 0.25];
    const landmarks = makeLandmarks();
    expect(classifyGrip(curls, landmarks)).toBe('open');
  });

  it('returns "pinch" when thumb + index extended, others curled, and tips close', () => {
    const curls: [number, number, number, number, number] = [0.1, 0.1, 0.8, 0.8, 0.8];
    // thumb tip (4) and index tip (8) very close together
    const landmarks = makeLandmarks({
      4: { x: 0.5, y: 0.5, z: 0 },
      8: { x: 0.51, y: 0.5, z: 0 },
    });
    expect(classifyGrip(curls, landmarks)).toBe('pinch');
  });

  it('returns "point" when thumb+index extended but tips far apart (fails pinch, matches point)', () => {
    const curls: [number, number, number, number, number] = [0.1, 0.1, 0.8, 0.8, 0.8];
    // thumb tip (4) and index tip (8) far apart — fails pinch distance check
    const landmarks = makeLandmarks({
      4: { x: 0, y: 0, z: 0 },
      8: { x: 1, y: 1, z: 0 },
    });
    // Pinch fails (distance > 0.05). Point matches: indexCurl < 0.3, middle/ring/pinky > 0.6
    expect(classifyGrip(curls, landmarks)).toBe('point');
  });

  it('returns "point" when only index is extended', () => {
    const curls: [number, number, number, number, number] = [0.8, 0.1, 0.9, 0.9, 0.9];
    const landmarks = makeLandmarks();
    expect(classifyGrip(curls, landmarks)).toBe('point');
  });

  it('returns "partial" for ambiguous poses', () => {
    // Middle range values that don't match any specific pattern
    const curls: [number, number, number, number, number] = [0.5, 0.5, 0.5, 0.5, 0.5];
    const landmarks = makeLandmarks();
    expect(classifyGrip(curls, landmarks)).toBe('partial');
  });

  it('returns "fist" at exact boundary (all 0.71)', () => {
    const curls: [number, number, number, number, number] = [0.71, 0.71, 0.71, 0.71, 0.71];
    const landmarks = makeLandmarks();
    expect(classifyGrip(curls, landmarks)).toBe('fist');
  });

  it('returns "open" at near-boundary (all 0.29)', () => {
    const curls: [number, number, number, number, number] = [0.29, 0.29, 0.29, 0.29, 0.29];
    const landmarks = makeLandmarks();
    expect(classifyGrip(curls, landmarks)).toBe('open');
  });

  it('returns "partial" when thumb is exactly 0.7 (not > 0.7, fails fist threshold)', () => {
    const curls: [number, number, number, number, number] = [0.7, 0.8, 0.8, 0.8, 0.8];
    const landmarks = makeLandmarks();
    // Thumb 0.7 is not > 0.7, so fist fails. Not open (all > 0.3). Not pinch (curls too high).
    // Not point (index 0.8 is not < 0.3). Falls through to partial.
    expect(classifyGrip(curls, landmarks)).toBe('partial');
  });
});
