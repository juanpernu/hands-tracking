// src/utils/__tests__/hand-features.test.ts

import { describe, it, expect } from 'vitest';
import {
  computeJointAngle,
  extractJointAngles,
  extractPalmOrientation,
  extractInterFingerSpread,
  extractThumbOpposition,
  computeHandSize,
  applyJointConstraints,
  computeFingerCurlRatio,
  computeHandOpenness,
} from '../hand-features';
import type { Landmark } from '../../types';

// Helper: create a landmark at a known position
function lm(x: number, y: number, z: number): Landmark {
  return { x, y, z };
}

// A straight finger: MCP, PIP, DIP, TIP in a line along X axis
function straightFinger(baseX: number): Landmark[] {
  return [
    lm(baseX, 0, 0),       // MCP
    lm(baseX + 1, 0, 0),   // PIP
    lm(baseX + 2, 0, 0),   // DIP
    lm(baseX + 3, 0, 0),   // TIP
  ];
}

// A 90-degree bent finger at PIP
function bentFinger(baseX: number): Landmark[] {
  return [
    lm(baseX, 0, 0),       // MCP
    lm(baseX + 1, 0, 0),   // PIP
    lm(baseX + 1, 1, 0),   // DIP (bent 90° downward)
    lm(baseX + 1, 2, 0),   // TIP
  ];
}

describe('computeJointAngle', () => {
  it('returns ~0 for straight joints (3 collinear points)', () => {
    const angle = computeJointAngle(lm(0, 0, 0), lm(1, 0, 0), lm(2, 0, 0));
    expect(angle).toBeCloseTo(0, 1);
  });

  it('returns ~PI/2 for a 90-degree bend', () => {
    const angle = computeJointAngle(lm(0, 0, 0), lm(1, 0, 0), lm(1, 1, 0));
    expect(angle).toBeCloseTo(Math.PI / 2, 1);
  });

  it('returns ~PI for a fully folded joint (180° bend)', () => {
    const angle = computeJointAngle(lm(0, 0, 0), lm(1, 0, 0), lm(0, 0, 0));
    // When tip is at parent position, angle approaches PI
    expect(angle).toBeCloseTo(Math.PI, 0);
  });
});

describe('extractPalmOrientation', () => {
  it('computes a non-zero normal for a valid hand', () => {
    // Flat hand on XY plane
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    landmarks[0] = lm(0, 0, 0);   // wrist
    landmarks[5] = lm(1, 0, 0);   // index MCP
    landmarks[17] = lm(0, 1, 0);  // pinky MCP
    landmarks[9] = lm(0.5, 0.5, 0); // middle MCP

    const result = extractPalmOrientation(landmarks);
    // Normal should point in Z direction for a flat XY hand
    expect(Math.abs(result.normal.z)).toBeGreaterThan(0);
  });
});

describe('extractInterFingerSpread', () => {
  it('returns 4 spread angles', () => {
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    // Set MCP positions for spread calculation
    landmarks[0] = lm(0, 0, 0);   // wrist
    landmarks[2] = lm(0.5, 1, 0); // thumb MCP
    landmarks[5] = lm(1, 1, 0);   // index MCP
    landmarks[9] = lm(1.5, 1, 0); // middle MCP
    landmarks[13] = lm(2, 1, 0);  // ring MCP
    landmarks[17] = lm(2.5, 1, 0); // pinky MCP

    const result = extractInterFingerSpread(landmarks);
    expect(result).toHaveLength(4);
    result.forEach(angle => {
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThanOrEqual(Math.PI);
    });
  });
});

describe('extractThumbOpposition', () => {
  it('returns 4 normalized distances', () => {
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    landmarks[0] = lm(0, 0, 0);   // wrist
    landmarks[9] = lm(1, 0, 0);   // middle MCP (for handSize)
    landmarks[4] = lm(0.5, 0.5, 0);  // thumb tip
    landmarks[8] = lm(1, 0.5, 0);    // index tip
    landmarks[12] = lm(1.5, 0.5, 0); // middle tip
    landmarks[16] = lm(2, 0.5, 0);   // ring tip
    landmarks[20] = lm(2.5, 0.5, 0); // pinky tip

    const handSize = 1.0;
    const result = extractThumbOpposition(landmarks, handSize);
    expect(result).toHaveLength(4);
    result.forEach(d => {
      expect(d).toBeGreaterThanOrEqual(0);
    });
    // Thumb is closest to index, farthest from pinky
    expect(result[0]).toBeLessThan(result[3]);
  });
});

describe('computeHandSize', () => {
  it('computes distance from wrist to middle MCP', () => {
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    landmarks[0] = lm(0, 0, 0); // wrist
    landmarks[9] = lm(3, 4, 0); // middle MCP
    const size = computeHandSize(landmarks);
    expect(size).toBeCloseTo(5, 5); // 3-4-5 triangle
  });

  it('returns a minimum value to prevent division by zero', () => {
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    const size = computeHandSize(landmarks);
    expect(size).toBeGreaterThan(0);
  });
});

describe('applyJointConstraints', () => {
  it('clamps angles within physiological limits', () => {
    const result = applyJointConstraints({
      thumb:  { mcp: -0.5, pip: 0.5, dip: 0.5 },
      index:  { mcp: 0.3, pip: 2.5, dip: 0.3 },  // PIP over limit
      middle: { mcp: 0.3, pip: 0.5, dip: 2.0 },   // DIP over limit
      ring:   { mcp: 0.3, pip: 0.5, dip: 0.3 },
      pinky:  { mcp: 0.3, pip: 0.5, dip: 0.3 },
    });

    // MCP should be clamped to >= 0
    expect(result.thumb.mcp).toBeGreaterThanOrEqual(0);
    // PIP should be clamped to <= 110° (1.9199 rad)
    expect(result.index.pip).toBeLessThanOrEqual((110 / 180) * Math.PI + 0.001);
    // DIP should be clamped to <= 90° (PI/2)
    expect(result.middle.dip).toBeLessThanOrEqual(Math.PI / 2 + 0.001);
  });
});

describe('computeFingerCurlRatio', () => {
  it('returns ~0 for a straight finger', () => {
    const [mcp, pip, dip, tip] = straightFinger(0);
    const ratio = computeFingerCurlRatio(mcp, pip, dip, tip);
    expect(ratio).toBeCloseTo(0, 1);
  });

  it('returns > 0 for a bent finger', () => {
    const [mcp, pip, dip, tip] = bentFinger(0);
    const ratio = computeFingerCurlRatio(mcp, pip, dip, tip);
    expect(ratio).toBeGreaterThan(0.1);
  });
});

describe('computeHandOpenness', () => {
  it('returns higher value for spread fingers', () => {
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    // Palm center approx at wrist
    landmarks[0] = lm(0, 0, 0);
    // Fingertips far away
    landmarks[4] = lm(2, 2, 0);
    landmarks[8] = lm(3, 2, 0);
    landmarks[12] = lm(4, 2, 0);
    landmarks[16] = lm(3, 3, 0);
    landmarks[20] = lm(2, 3, 0);
    // Middle MCP for hand size
    landmarks[9] = lm(2, 0, 0);

    const handSize = 2.0;
    const open = computeHandOpenness(landmarks, handSize);
    expect(open).toBeGreaterThan(0.5);
  });
});
