import { speedToColor, gripColor } from '../colors';

// ---------------------------------------------------------------------------
// speedToColor
// ---------------------------------------------------------------------------
describe('speedToColor', () => {
  it('returns blue (#4A90D9) for speed 0', () => {
    expect(speedToColor(0)).toBe('#4A90D9');
  });

  it('returns blue for speed just below 2', () => {
    expect(speedToColor(1.99)).toBe('#4A90D9');
  });

  it('returns green (#27C93F) for speed 2', () => {
    expect(speedToColor(2)).toBe('#27C93F');
  });

  it('returns green for speed 5 (between 2 and 8)', () => {
    expect(speedToColor(5)).toBe('#27C93F');
  });

  it('returns yellow (#FFBD2E) for speed 8', () => {
    expect(speedToColor(8)).toBe('#FFBD2E');
  });

  it('returns yellow for speed 15 (between 8 and 20)', () => {
    expect(speedToColor(15)).toBe('#FFBD2E');
  });

  it('returns red (#FF5F56) for speed 20', () => {
    expect(speedToColor(20)).toBe('#FF5F56');
  });

  it('returns red for very high speed', () => {
    expect(speedToColor(100)).toBe('#FF5F56');
  });
});

// ---------------------------------------------------------------------------
// gripColor
// ---------------------------------------------------------------------------
describe('gripColor', () => {
  it('returns green (#27C93F) for value 0', () => {
    expect(gripColor(0)).toBe('#27C93F');
  });

  it('returns green for value just below 0.3', () => {
    expect(gripColor(0.29)).toBe('#27C93F');
  });

  it('returns yellow (#FFBD2E) for value 0.3', () => {
    expect(gripColor(0.3)).toBe('#FFBD2E');
  });

  it('returns yellow for value 0.5 (between 0.3 and 0.7)', () => {
    expect(gripColor(0.5)).toBe('#FFBD2E');
  });

  it('returns red (#FF5F56) for value 0.7', () => {
    expect(gripColor(0.7)).toBe('#FF5F56');
  });

  it('returns red for value 1.0', () => {
    expect(gripColor(1.0)).toBe('#FF5F56');
  });
});
