import { wrapAngleDelta } from '../motion';

describe('wrapAngleDelta', () => {
  it('returns 0 for delta 0', () => {
    expect(wrapAngleDelta(0)).toBe(0);
  });

  it('wraps delta > PI to negative range', () => {
    // delta = 3*PI/2 should wrap to -PI/2
    const delta = (3 * Math.PI) / 2;
    const result = wrapAngleDelta(delta);
    expect(result).toBeCloseTo(-Math.PI / 2);
  });

  it('wraps delta < -PI to positive range', () => {
    // delta = -3*PI/2 should wrap to PI/2
    const delta = (-3 * Math.PI) / 2;
    const result = wrapAngleDelta(delta);
    expect(result).toBeCloseTo(Math.PI / 2);
  });

  it('returns PI for exactly PI', () => {
    expect(wrapAngleDelta(Math.PI)).toBeCloseTo(Math.PI);
  });

  it('returns -PI for exactly -PI', () => {
    expect(wrapAngleDelta(-Math.PI)).toBeCloseTo(-Math.PI);
  });

  it('does not change values already in (-PI, PI)', () => {
    expect(wrapAngleDelta(1)).toBeCloseTo(1);
    expect(wrapAngleDelta(-1)).toBeCloseTo(-1);
    expect(wrapAngleDelta(0.5)).toBeCloseTo(0.5);
  });

  it('handles large positive multiples of 2*PI', () => {
    // 4*PI + 0.5 should wrap to 0.5
    const delta = 4 * Math.PI + 0.5;
    const result = wrapAngleDelta(delta);
    expect(result).toBeCloseTo(0.5);
  });

  it('handles large negative multiples of 2*PI', () => {
    // -4*PI - 0.5 should wrap to -0.5
    const delta = -4 * Math.PI - 0.5;
    const result = wrapAngleDelta(delta);
    expect(result).toBeCloseTo(-0.5);
  });
});
