import { describe, it, expect } from 'vitest';
import {
  scoreElement,
  isSemanticInteractive,
  isGenericContainer,
  generateSelector,
  hasOverlap,
  computeContact,
  closestEdgeDistance,
  computeProximity,
  approachDirection,
  filterAndScoreStack,
} from '../spatial';

// Helper: create a minimal DOM element with getBoundingClientRect
function makeEl(tag: string, attrs: Record<string, string> = {}, width = 100, height = 50): Element {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  // jsdom doesn't compute layout, so we stub getBoundingClientRect
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, width, height, top: 0, right: width, bottom: height, left: 0,
    toJSON: () => ({}),
  });
  return el;
}

// Helper: create a DOMRect-like object
function rect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x, y, width: w, height: h,
    top: y, right: x + w, bottom: y + h, left: x,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('isSemanticInteractive', () => {
  it('returns true for button', () => {
    expect(isSemanticInteractive(makeEl('button'))).toBe(true);
  });
  it('returns true for anchor', () => {
    expect(isSemanticInteractive(makeEl('a'))).toBe(true);
  });
  it('returns true for input', () => {
    expect(isSemanticInteractive(makeEl('input'))).toBe(true);
  });
  it('returns true for role=button', () => {
    expect(isSemanticInteractive(makeEl('div', { role: 'button' }))).toBe(true);
  });
  it('returns true for tabindex', () => {
    expect(isSemanticInteractive(makeEl('div', { tabindex: '0' }))).toBe(true);
  });
  it('returns false for plain div', () => {
    expect(isSemanticInteractive(makeEl('div'))).toBe(false);
  });
});

describe('isGenericContainer', () => {
  it('returns true for body', () => {
    expect(isGenericContainer(makeEl('body'))).toBe(true);
  });
  it('returns true for main without role', () => {
    expect(isGenericContainer(makeEl('main'))).toBe(true);
  });
  it('returns false for section with role', () => {
    expect(isGenericContainer(makeEl('section', { role: 'button' }))).toBe(false);
  });
  it('returns false for section with onclick', () => {
    expect(isGenericContainer(makeEl('section', { onclick: 'fn()' }))).toBe(false);
  });
  it('returns false for div (not in container list)', () => {
    expect(isGenericContainer(makeEl('div'))).toBe(false);
  });
});

describe('scoreElement', () => {
  it('button with dimensions = 4 (semantic 3 + dim 1)', () => {
    expect(scoreElement(makeEl('button'))).toBe(4);
  });
  it('body = -2 (container -2, too large but still generic)', () => {
    expect(scoreElement(makeEl('body'))).toBe(-1);
  });
  it('div[data-trackable] = 6 (trackable 5 + dim 1)', () => {
    expect(scoreElement(makeEl('div', { 'data-trackable': '' }))).toBe(6);
  });
  it('a[role=button] = 4 (semantic 3 + dim 1, role doesn\'t stack)', () => {
    expect(scoreElement(makeEl('a', { role: 'button' }))).toBe(4);
  });
  it('small element below min dimensions = 0', () => {
    expect(scoreElement(makeEl('div', {}, 10, 10))).toBe(0);
  });
  it('div with onclick = 3 (listeners 2 + dim 1)', () => {
    expect(scoreElement(makeEl('div', { onclick: 'fn()' }))).toBe(3);
  });
});

describe('generateSelector', () => {
  it('element with id returns #id', () => {
    expect(generateSelector(makeEl('div', { id: 'hero' }))).toBe('#hero');
  });
  it('element with classes returns tag.class1.class2', () => {
    const el = makeEl('button', { class: 'primary large' });
    expect(generateSelector(el)).toBe('button.primary.large');
  });
  it('plain element returns tagName', () => {
    expect(generateSelector(makeEl('span'))).toBe('span');
  });
});

describe('hasOverlap', () => {
  it('returns false for non-overlapping rects (horizontal gap)', () => {
    expect(hasOverlap(rect(0, 0, 50, 50), rect(100, 0, 50, 50))).toBe(false);
  });
  it('returns false for non-overlapping rects (vertical gap)', () => {
    expect(hasOverlap(rect(0, 0, 50, 50), rect(0, 100, 50, 50))).toBe(false);
  });
  it('returns true for overlapping rects', () => {
    expect(hasOverlap(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toBe(true);
  });
  it('returns false for edge-touching rects (zero overlap)', () => {
    expect(hasOverlap(rect(0, 0, 50, 50), rect(50, 0, 50, 50))).toBe(false);
  });
});

describe('computeContact', () => {
  it('returns null for non-overlapping rects', () => {
    expect(computeContact(rect(0, 0, 50, 50), 2500, rect(100, 0, 50, 50), 2500)).toBeNull();
  });
  it('returns correct contact for partial overlap', () => {
    const c = computeContact(rect(0, 0, 100, 100), 10000, rect(80, 80, 100, 100), 10000);
    expect(c).not.toBeNull();
    expect(c!.overlapArea).toBe(400); // 20 * 20
    expect(c!.overlapRatioA).toBeCloseTo(0.04); // 400/10000
    expect(c!.overlapRatioB).toBeCloseTo(0.04);
    expect(c!.contactAxis).toBe('both');
  });
  it('returns ratio 1.0 for full containment of smaller element', () => {
    const c = computeContact(rect(0, 0, 200, 200), 40000, rect(50, 50, 50, 50), 2500);
    expect(c).not.toBeNull();
    expect(c!.overlapRatioB).toBeCloseTo(1.0);
  });
  it('detects horizontal-only contact axis', () => {
    // Rects overlap 10px horizontally but full 100px vertically
    const c = computeContact(rect(0, 0, 100, 100), 10000, rect(90, 0, 100, 100), 10000);
    expect(c).not.toBeNull();
    expect(c!.contactAxis).toBe('horizontal');
  });
});

describe('closestEdgeDistance', () => {
  it('horizontal gap', () => {
    expect(closestEdgeDistance(rect(0, 0, 50, 50), rect(80, 0, 50, 50))).toBe(30);
  });
  it('vertical gap', () => {
    expect(closestEdgeDistance(rect(0, 0, 50, 50), rect(0, 70, 50, 50))).toBe(20);
  });
  it('overlapping returns 0', () => {
    expect(closestEdgeDistance(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toBe(0);
  });
  it('adjacent (touching) returns 0', () => {
    expect(closestEdgeDistance(rect(0, 0, 50, 50), rect(50, 0, 50, 50))).toBe(0);
  });
});

describe('computeProximity', () => {
  it('returns null if beyond maxDistance', () => {
    expect(computeProximity(rect(0, 0, 50, 50), rect(200, 0, 50, 50), 50)).toBeNull();
  });
  it('returns proximity within range', () => {
    const p = computeProximity(rect(0, 0, 50, 50), rect(80, 0, 50, 50), 50);
    expect(p).not.toBeNull();
    expect(p!.distance).toBe(30);
    expect(p!.axis).toBe('horizontal');
  });
  it('returns null for overlapping rects (use computeContact instead)', () => {
    expect(computeProximity(rect(0, 0, 100, 100), rect(50, 50, 100, 100), 50)).toBeNull();
  });
  it('detects diagonal proximity', () => {
    const p = computeProximity(rect(0, 0, 50, 50), rect(60, 60, 50, 50), 100);
    expect(p).not.toBeNull();
    expect(p!.axis).toBe('diagonal');
  });
});

describe('approachDirection', () => {
  it('returns unit vector pointing from A center to B center', () => {
    const dir = approachDirection(rect(0, 0, 100, 100), rect(200, 0, 100, 100));
    expect(dir.x).toBeCloseTo(1);
    expect(dir.y).toBeCloseTo(0);
  });
  it('returns downward vector', () => {
    const dir = approachDirection(rect(0, 0, 100, 100), rect(0, 200, 100, 100));
    expect(dir.x).toBeCloseTo(0);
    expect(dir.y).toBeCloseTo(1);
  });
});

describe('filterAndScoreStack', () => {
  it('returns empty array for empty input', () => {
    expect(filterAndScoreStack([])).toEqual([]);
  });
  it('sorts by score descending', () => {
    const btn = makeEl('button');
    const div = makeEl('div');
    const result = filterAndScoreStack([div, btn]);
    expect(result[0].tagName).toBe('BUTTON');
  });
  it('includes all elements (no filtering by score)', () => {
    const body = makeEl('body');
    const btn = makeEl('button');
    const result = filterAndScoreStack([body, btn]);
    expect(result.length).toBe(2);
  });
});
