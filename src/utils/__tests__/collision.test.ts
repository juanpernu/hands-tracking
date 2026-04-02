import { objectsOverlap, resolveCollisions } from '../collision';
import type { DraggableObjectData } from '../../types';

function makeObj(
  overrides: Partial<DraggableObjectData> & { id: string },
): DraggableObjectData {
  return {
    x: 0,
    y: 0,
    width: 80,
    height: 80,
    color: '#FF0000',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// objectsOverlap
// ---------------------------------------------------------------------------
describe('objectsOverlap', () => {
  it('returns false for non-overlapping objects', () => {
    const a = makeObj({ id: 'a', x: 0, y: 0 });
    const b = makeObj({ id: 'b', x: 200, y: 200 });
    expect(objectsOverlap(a, b)).toBe(false);
  });

  it('returns true for overlapping objects', () => {
    const a = makeObj({ id: 'a', x: 0, y: 0 });
    const b = makeObj({ id: 'b', x: 40, y: 40 });
    expect(objectsOverlap(a, b)).toBe(true);
  });

  it('returns false for adjacent objects (touching edge, no overlap)', () => {
    const a = makeObj({ id: 'a', x: 0, y: 0 });
    const b = makeObj({ id: 'b', x: 80, y: 0 }); // a.x + a.width === b.x
    // The condition is a.x < b.x + b.width (0 < 160 true) AND a.x + a.width > b.x (80 > 80 false)
    expect(objectsOverlap(a, b)).toBe(false);
  });

  it('returns true for partial overlap on one axis', () => {
    const a = makeObj({ id: 'a', x: 0, y: 0 });
    const b = makeObj({ id: 'b', x: 79, y: 0 }); // 1px of horizontal overlap
    expect(objectsOverlap(a, b)).toBe(true);
  });

  it('returns false when separated vertically', () => {
    const a = makeObj({ id: 'a', x: 0, y: 0 });
    const b = makeObj({ id: 'b', x: 0, y: 100 });
    expect(objectsOverlap(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveCollisions
// ---------------------------------------------------------------------------
describe('resolveCollisions', () => {
  const W = 1000;
  const H = 800;

  it('leaves non-overlapping objects unchanged', () => {
    const a = makeObj({ id: 'a', x: 0, y: 0 });
    const b = makeObj({ id: 'b', x: 200, y: 200 });
    const result = resolveCollisions([a, b], null, W, H);

    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    expect(result[1].x).toBe(200);
    expect(result[1].y).toBe(200);
  });

  it('pushes overlapping objects apart', () => {
    const a = makeObj({ id: 'a', x: 50, y: 50 });
    const b = makeObj({ id: 'b', x: 60, y: 50 }); // overlapping by 70px on x
    const result = resolveCollisions([a, b], null, W, H);

    // After resolution they should no longer overlap
    expect(objectsOverlap(result[0], result[1])).toBe(false);
  });

  it('keeps the moved object in place and pushes the other', () => {
    const a = makeObj({ id: 'moved', x: 50, y: 50 });
    const b = makeObj({ id: 'other', x: 60, y: 50 });
    const result = resolveCollisions([a, b], 'moved', W, H);

    // The moved object should stay at its original position
    expect(result[0].x).toBe(50);
    expect(result[0].y).toBe(50);
    // The other object should have been pushed away
    expect(objectsOverlap(result[0], result[1])).toBe(false);
  });

  it('clamps objects to workspace bounds', () => {
    // Place two objects near the right edge, overlapping
    const a = makeObj({ id: 'a', x: W - 90, y: 50 });
    const b = makeObj({ id: 'b', x: W - 80, y: 50 });
    const result = resolveCollisions([a, b], null, W, H);

    for (const obj of result) {
      expect(obj.x).toBeGreaterThanOrEqual(0);
      expect(obj.y).toBeGreaterThanOrEqual(0);
      expect(obj.x + obj.width).toBeLessThanOrEqual(W);
      expect(obj.y + obj.height).toBeLessThanOrEqual(H);
    }
  });

  it('returns a new array (does not mutate input)', () => {
    const a = makeObj({ id: 'a', x: 50, y: 50 });
    const b = makeObj({ id: 'b', x: 60, y: 50 });
    const input = [a, b];
    const result = resolveCollisions(input, null, W, H);

    expect(result).not.toBe(input);
    // Original objects should be untouched
    expect(a.x).toBe(50);
    expect(b.x).toBe(60);
  });
});
