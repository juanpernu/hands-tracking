import { SPATIAL } from '../config';
import type { SpatialElement, ElementContact, ElementProximity } from '../types/spatial';

// --- Semantic classification ---

const INTERACTIVE_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY',
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch',
  'option', 'slider', 'spinbutton', 'textbox', 'combobox',
]);

const CONTAINER_TAGS = new Set([
  'BODY', 'HTML', 'MAIN', 'SECTION', 'ARTICLE', 'NAV', 'HEADER', 'FOOTER',
]);

const LISTENER_ATTRS = ['onclick', 'onpointerdown', 'onmousedown', 'ontouchstart'];
const BUTTON_CLASS_PATTERNS = ['btn', 'button', 'click'];

export function isSemanticInteractive(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (el.hasAttribute('tabindex')) return true;
  return false;
}

export function isGenericContainer(el: Element): boolean {
  if (!CONTAINER_TAGS.has(el.tagName)) return false;
  if (el.getAttribute('role')) return false;
  if (LISTENER_ATTRS.some((a) => el.hasAttribute(a))) return false;
  return true;
}

function hasListenerAttributes(el: Element): boolean {
  if (LISTENER_ATTRS.some((a) => el.hasAttribute(a))) return true;
  const cls = el.className;
  if (typeof cls === 'string') {
    const lower = cls.toLowerCase();
    if (BUTTON_CLASS_PATTERNS.some((p) => lower.includes(p))) return true;
  }
  return false;
}

export function scoreElement(el: Element, rect?: DOMRect): number {
  let score = 0;
  if (isSemanticInteractive(el)) score += SPATIAL.SCORE_SEMANTIC_INTERACTIVE;
  if (hasListenerAttributes(el)) score += SPATIAL.SCORE_HAS_LISTENERS;
  const r = rect ?? el.getBoundingClientRect();
  if (r.width > SPATIAL.MIN_ELEMENT_WIDTH && r.height > SPATIAL.MIN_ELEMENT_HEIGHT) {
    score += SPATIAL.SCORE_MIN_DIMENSIONS;
  }
  if (isGenericContainer(el)) score += SPATIAL.SCORE_GENERIC_CONTAINER;
  if (el.hasAttribute('data-trackable')) score += SPATIAL.SCORE_DATA_TRACKABLE;
  return score;
}

// --- Selector generation ---

export function generateSelector(el: Element): string {
  const id = el.getAttribute('id');
  if (id) return `#${id}`;
  const classes = el.className;
  if (typeof classes === 'string' && classes.trim()) {
    return `${el.tagName.toLowerCase()}.${classes.trim().split(/\s+/).join('.')}`;
  }
  return el.tagName.toLowerCase();
}

// --- Geometry: overlap / contact ---

export function hasOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function computeContact(
  rectA: DOMRect, areaA: number,
  rectB: DOMRect, areaB: number,
): Omit<ElementContact, 'elementA' | 'elementB'> | null {
  if (!hasOverlap(rectA, rectB)) return null;
  const overlapX = Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left);
  const overlapY = Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top);
  const overlapArea = overlapX * overlapY;
  if (overlapArea <= 0) return null;

  const overlapRatioA = areaA > 0 ? overlapArea / areaA : 0;
  const overlapRatioB = areaB > 0 ? overlapArea / areaB : 0;

  // Determine contact axis: if one dimension overlap is much larger than the other,
  // the contact is primarily on the smaller overlap axis
  const ratio = overlapX / overlapY;
  let contactAxis: 'horizontal' | 'vertical' | 'both';
  if (ratio < 0.5) contactAxis = 'horizontal';
  else if (ratio > 2) contactAxis = 'vertical';
  else contactAxis = 'both';

  return { overlapArea, overlapRatioA, overlapRatioB, contactAxis };
}

// --- Geometry: proximity ---

export function closestEdgeDistance(a: DOMRect, b: DOMRect): number {
  if (hasOverlap(a, b)) return 0;
  const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
  const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
  return Math.sqrt(dx * dx + dy * dy);
}

export function approachDirection(a: DOMRect, b: DOMRect): { x: number; y: number } {
  const cx = (b.left + b.width / 2) - (a.left + a.width / 2);
  const cy = (b.top + b.height / 2) - (a.top + a.height / 2);
  const mag = Math.sqrt(cx * cx + cy * cy);
  if (mag === 0) return { x: 0, y: 0 };
  return { x: cx / mag, y: cy / mag };
}

export function computeProximity(
  rectA: DOMRect, rectB: DOMRect, maxDistance: number,
): Omit<ElementProximity, 'elementA' | 'elementB'> | null {
  if (hasOverlap(rectA, rectB)) return null;

  const distance = closestEdgeDistance(rectA, rectB);
  if (distance <= 0 || distance > maxDistance) return null;

  const direction = approachDirection(rectA, rectB);

  const dx = Math.max(0, Math.max(rectA.left - rectB.right, rectB.left - rectA.right));
  const dy = Math.max(0, Math.max(rectA.top - rectB.bottom, rectB.top - rectA.bottom));
  let axis: 'horizontal' | 'vertical' | 'diagonal';
  if (dx > 0 && dy > 0) axis = 'diagonal';
  else if (dx > 0) axis = 'horizontal';
  else axis = 'vertical';

  return { distance, direction, axis };
}

// --- Stack filtering ---

export function filterAndScoreStack(elements: Element[]): SpatialElement[] {
  return elements.map((el) => {
    const rect = el.getBoundingClientRect();
    const score = scoreElement(el, rect);
    return {
      element: el,
      tagName: el.tagName,
      selector: generateSelector(el),
      rect,
      area: rect.width * rect.height,
      relevanceScore: score,
      isInteractive: score >= SPATIAL.INTERACTIVE_SCORE_THRESHOLD,
    };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);
}
