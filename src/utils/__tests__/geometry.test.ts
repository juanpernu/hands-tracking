import {
  distance,
  lerp,
  normalizedToPixel,
  clamp,
  distance3d,
  dot3,
  cross3,
  normalize3,
  magnitude3,
  sub3,
  centroid3,
  hitTest,
} from '../geometry';

// ---------------------------------------------------------------------------
// distance
// ---------------------------------------------------------------------------
describe('distance', () => {
  it('returns 0 for the same point', () => {
    expect(distance({ x: 5, y: 3 }, { x: 5, y: 3 })).toBe(0);
  });

  it('returns correct value for unit square diagonal', () => {
    expect(distance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(Math.SQRT2);
  });

  it('handles negative coordinates', () => {
    expect(distance({ x: -3, y: -4 }, { x: 0, y: 0 })).toBeCloseTo(5);
  });

  it('is symmetric', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 4, y: 6 };
    expect(distance(a, b)).toBeCloseTo(distance(b, a));
  });
});

// ---------------------------------------------------------------------------
// lerp
// ---------------------------------------------------------------------------
describe('lerp', () => {
  it('returns current when factor is 0', () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it('returns target when factor is 1', () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('returns midpoint when factor is 0.5', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });

  it('extrapolates beyond 0-1 range', () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });
});

// ---------------------------------------------------------------------------
// normalizedToPixel
// ---------------------------------------------------------------------------
describe('normalizedToPixel', () => {
  it('maps (0,0) to (width, 0) because X is mirrored', () => {
    const result = normalizedToPixel({ x: 0, y: 0 }, 1920, 1080);
    expect(result.x).toBe(1920);
    expect(result.y).toBe(0);
  });

  it('maps (0.5, 0.5) to center of the screen', () => {
    const result = normalizedToPixel({ x: 0.5, y: 0.5 }, 1920, 1080);
    expect(result.x).toBeCloseTo(960);
    expect(result.y).toBeCloseTo(540);
  });

  it('maps (1,1) to (0, height)', () => {
    const result = normalizedToPixel({ x: 1, y: 1 }, 1920, 1080);
    expect(result.x).toBe(0);
    expect(result.y).toBe(1080);
  });

  it('handles non-standard dimensions', () => {
    const result = normalizedToPixel({ x: 0.25, y: 0.75 }, 800, 600);
    expect(result.x).toBeCloseTo(600);
    expect(result.y).toBeCloseTo(450);
  });
});

// ---------------------------------------------------------------------------
// hitTest
// ---------------------------------------------------------------------------
describe('hitTest', () => {
  const obj = { x: 10, y: 10, width: 50, height: 50 };

  it('returns true when cursor is inside', () => {
    expect(hitTest({ x: 30, y: 30 }, obj)).toBe(true);
  });

  it('returns false when cursor is outside', () => {
    expect(hitTest({ x: 0, y: 0 }, obj)).toBe(false);
  });

  it('returns true at the top-left corner (boundary)', () => {
    expect(hitTest({ x: 10, y: 10 }, obj)).toBe(true);
  });

  it('returns true at the bottom-right corner (boundary)', () => {
    expect(hitTest({ x: 60, y: 60 }, obj)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------
describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps below min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns min when value equals min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it('returns max when value equals max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// distance3d
// ---------------------------------------------------------------------------
describe('distance3d', () => {
  it('returns 0 for the same point', () => {
    expect(distance3d({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 })).toBe(0);
  });

  it('returns correct value for unit vectors', () => {
    expect(distance3d({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(1);
  });

  it('handles 3D diagonal', () => {
    expect(distance3d({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })).toBeCloseTo(Math.sqrt(3));
  });

  it('handles negative coordinates', () => {
    expect(distance3d({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 })).toBeCloseTo(Math.sqrt(12));
  });
});

// ---------------------------------------------------------------------------
// dot3
// ---------------------------------------------------------------------------
describe('dot3', () => {
  it('returns 0 for perpendicular vectors', () => {
    expect(dot3({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
  });

  it('returns magnitude squared for same vector', () => {
    expect(dot3({ x: 3, y: 4, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(25);
  });

  it('returns negative for opposite vectors', () => {
    expect(dot3({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })).toBe(-1);
  });

  it('computes correctly for arbitrary vectors', () => {
    expect(dot3({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// cross3
// ---------------------------------------------------------------------------
describe('cross3', () => {
  it('returns z-axis for x cross y', () => {
    const result = cross3({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(result).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('returns negative z-axis for y cross x', () => {
    const result = cross3({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(result).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('returns zero vector for parallel vectors', () => {
    const result = cross3({ x: 2, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
    expect(result).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('handles arbitrary vectors', () => {
    const result = cross3({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    // (2*6 - 3*5, 3*4 - 1*6, 1*5 - 2*4) = (-3, 6, -3)
    expect(result).toEqual({ x: -3, y: 6, z: -3 });
  });
});

// ---------------------------------------------------------------------------
// normalize3
// ---------------------------------------------------------------------------
describe('normalize3', () => {
  it('returns unit vector for axis-aligned input', () => {
    const result = normalize3({ x: 5, y: 0, z: 0 });
    expect(result).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('returns zero vector for zero input', () => {
    const result = normalize3({ x: 0, y: 0, z: 0 });
    expect(result).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('produces a vector with magnitude 1', () => {
    const result = normalize3({ x: 3, y: 4, z: 0 });
    const mag = Math.sqrt(result.x ** 2 + result.y ** 2 + result.z ** 2);
    expect(mag).toBeCloseTo(1);
  });

  it('preserves direction', () => {
    const result = normalize3({ x: -2, y: 0, z: 0 });
    expect(result.x).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// magnitude3
// ---------------------------------------------------------------------------
describe('magnitude3', () => {
  it('returns 0 for zero vector', () => {
    expect(magnitude3({ x: 0, y: 0, z: 0 })).toBe(0);
  });

  it('returns 1 for unit vector', () => {
    expect(magnitude3({ x: 1, y: 0, z: 0 })).toBe(1);
  });

  it('returns correct value for 3-4-5 triangle in 3D', () => {
    expect(magnitude3({ x: 3, y: 4, z: 0 })).toBeCloseTo(5);
  });

  it('handles negative components', () => {
    expect(magnitude3({ x: -1, y: -1, z: -1 })).toBeCloseTo(Math.sqrt(3));
  });
});

// ---------------------------------------------------------------------------
// sub3
// ---------------------------------------------------------------------------
describe('sub3', () => {
  it('returns zero vector when subtracting same point', () => {
    const result = sub3({ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 5 });
    expect(result).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('subtracts correctly', () => {
    const result = sub3({ x: 10, y: 20, z: 30 }, { x: 1, y: 2, z: 3 });
    expect(result).toEqual({ x: 9, y: 18, z: 27 });
  });

  it('handles negative results', () => {
    const result = sub3({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 });
    expect(result).toEqual({ x: -1, y: -2, z: -3 });
  });
});

// ---------------------------------------------------------------------------
// centroid3
// ---------------------------------------------------------------------------
describe('centroid3', () => {
  it('returns zero vector for empty array', () => {
    expect(centroid3([])).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('returns the point itself for single point', () => {
    expect(centroid3([{ x: 3, y: 4, z: 5 }])).toEqual({ x: 3, y: 4, z: 5 });
  });

  it('returns midpoint for two points', () => {
    const result = centroid3([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 10, z: 10 },
    ]);
    expect(result).toEqual({ x: 5, y: 5, z: 5 });
  });

  it('computes average of multiple points', () => {
    const result = centroid3([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
      { x: 7, y: 8, z: 9 },
    ]);
    expect(result).toEqual({ x: 4, y: 5, z: 6 });
  });
});
