# Hands-Tracker: Full Audit Report

**Date:** 2026-04-02
**Agents:** 4 (Performance, Security, Architecture, Testing)
**Scope:** Complete source code analysis of client-side React + MediaPipe hand-tracking app

---

## Executive Summary

The hook layer is genuinely strong -- individual hooks are clean, stateless, and well-scoped with a clean DAG dependency graph. The critical problems live at the composition layer: App.tsx is a 442-line god component that orchestrates everything, creating a cascade of performance and maintainability issues. Security posture is reasonable for a client-side app (no XSS, no network exfiltration) but has gaps in CDN integrity and biometric data handling. Testing is completely absent despite tooling being installed.

### Score Card

| Domain | Score | Key Issue |
|--------|-------|-----------|
| Performance | 3/10 | 11 setState/frame, callback instability, O(n^2) collisions, GC pressure |
| Security | 6/10 | No CDN integrity, biometric data unprotected, no CSP |
| Architecture | 4/10 | God component, no state machine, triple grip state source |
| Testing | 0/10 | Zero tests, zero coverage, zero configuration |

---

## Performance (5 Critical, 9 Warning, 10 Suggestions)

### Critical

| ID | Issue | File:Line | Impact |
|----|-------|-----------|--------|
| C1 | 11 state setters per frame in updateInteraction | App.tsx:88-284 | Entire component tree re-renders at 60fps |
| C2 | `objects` in dependency array recreates callback during drag | App.tsx:284 | Callback + effect torn down/rebuilt every frame |
| C3 | `hitTest` closes over objects state | useObjectManagement.ts:178-189 | Forces callback instability through entire chain |
| C4 | `resolveCollisions` clones all objects O(n^2)x3 per frame | useObjectManagement.ts:44 | 34,200 collision checks/sec, heavy GC pressure |
| C5 | `timelineEntries` filter + spread every frame | App.tsx:278-283 | ~300 filter iterations + array allocations per frame |

### Top Warnings

- W1: `gestureEvents` array grows unbounded (useTelemetryRecorder.ts:189)
- W2: `useTelemetryLogger` log spreads 500 entries on every add (useTelemetryLogger.ts:83-88)
- W3: `DraggablePanel` hand-cursor effect fires every frame (DraggablePanel.tsx:84-127)
- W4: `EventLog` filters entries on every render (EventLog.tsx:36)
- W5: Canvas components re-render + redraw every frame unnecessarily (HandSkeleton.tsx, VelocityVectors.tsx)
- W6: `partialLowGrabLeft/Right` reads stale closure value (App.tsx:119,125)
- W7: `useMouseFallback` setState on every mousemove (useMouseFallback.ts:36)
- W8: Shake-to-clear creates N uncleared timeouts (App.tsx:181-186)
- W9: `borderStyle()` returns new object every render (App.tsx:315-333)

### Highest-Impact Fix

Refactor App.tsx: interaction loop should run via requestAnimationFrame writing to refs. Only push state to React on meaningful changes. Throttle telemetry UI to 5-10fps.

---

## Security (0 Critical, 2 High, 4 Medium, 3 Low, 3 Info)

### High

| ID | Issue | File:Line | Remediation |
|----|-------|-----------|-------------|
| HIGH-01 | CDN resources loaded without SRI | useHandTracking.ts:6-9 | Self-host WASM + model in public/, or fetch-then-verify with SHA-256 |
| HIGH-02 | Biometric landmark data exported without privacy controls | useTelemetryRecorder.ts:104-115,198-236 | Consent mechanism, data minimization, add telemetry/ to .gitignore |

### Medium

| ID | Issue | File:Line |
|----|-------|-----------|
| MEDIUM-01 | No Content Security Policy for production | index.html |
| MEDIUM-02 | Raw error messages exposed to UI | useHandTracking.ts:86-89,139-142 |
| MEDIUM-03 | Global keyboard handler captures all 'T' keystrokes | TelemetryOverlay.tsx:11-14 |
| MEDIUM-04 | Unbounded memory growth in gestureEvents | useTelemetryRecorder.ts:189-191 |

### Positive Observations

- Zero network exfiltration (telemetry stays client-side)
- No localStorage/IndexedDB (closing tab destroys all data)
- No eval(), Function(), or dynamic code execution
- No dangerouslySetInnerHTML (React escaping throughout)
- Proper camera cleanup on unmount
- Dependencies current, no known CVEs
- StrictMode enabled

---

## Architecture (3 High, 4 Medium, 4 Low)

### High Impact

| ID | Issue | Location |
|----|-------|----------|
| 1 | God component: App.tsx owns 9 useState, 6 useRef, 10 hooks, 190-line callback | App.tsx:1-441 |
| 2 | Gesture-to-action mapping embedded in render component as if/else chains | App.tsx:222-276 |
| 3 | Triple grip state source (useGripDetection, partialLowGrab*, panelHandCursors) | App.tsx + useGripDetection |

### Medium Impact

| ID | Issue | Location |
|----|-------|----------|
| 4 | No state machine -- GestureState is ad-hoc enum with implicit transitions | App.tsx:223-276 |
| 5 | useObjectManagement reads window.innerWidth/Height directly | useObjectManagement.ts:94-120 |
| 6 | DraggablePanel has its own parallel drag system | DraggablePanel.tsx:84-127 |
| 7 | Two telemetry hooks with overlapping shake detection | useTelemetryRecorder + useTelemetryLogger |

### Dead Code

- `MacWindow.tsx` -- never imported
- `WorkspaceCanvas.tsx` -- never imported
- `TelemetryHUD.tsx` -- never imported (superseded by DualHandHUD)
- `WORKSPACE` constant in types/index.ts -- unused

### Strengths

- Hooks form a clean DAG with no circular dependencies
- MediaPipe isolated to single hook (useHandTracking)
- Each processing hook has well-defined input/output contract
- Pipeline is testable with synthetic data (no camera needed)

### Recommended Decomposition

1. **Extract `useInteractionController`** -- owns gesture state, grabbed IDs, grab offsets, gesture-to-action mapping, shake-to-clear
2. **Extract `useHandAnalysis`** -- composes useHandPhysics + useGripDetection + useMotionRecognition
3. **Create `GestureActionMap`** -- data-driven gesture-to-action mapping (command pattern)
4. **Delete dead files** -- MacWindow, WorkspaceCanvas, TelemetryHUD
5. **Move `speedToColor`/`gripColor`** to shared utils (duplicated in 4 files)
6. **Inject viewport dimensions** into useObjectManagement (testability)

---

## Testing (0 tests, 0% coverage)

### Current State

- Vitest 4.1.2 + Testing Library installed but completely unused
- No test files, no vitest config, no test script in package.json
- No setupTests.ts

### Risk Assessment (untested critical logic)

| Priority | Component | Risk |
|----------|-----------|------|
| P0 | classifyGrip() thresholds | Wrong classification = user can't interact |
| P0 | computeFingerCurl() math | Foundation of all grip detection |
| P0 | Pinch hysteresis (0.05/0.07) | Wrong = flicker or inability to grab |
| P0 | resolveCollisions() | Bugs = objects overlap/teleport/escape |
| P0 | geometry.ts pure functions | Foundation of all coordinate math |
| P1 | Grip hysteresis (3-frame confirm) | Off-by-one = delayed response |
| P1 | Motion pattern detectors | Circular angle wrap bugs |
| P1 | Dual-hand interaction | Race condition: both hands grab same object |

### Key Insight

The codebase is well-structured for testing. 18+ pure functions exist but many are module-private (trapped inside hooks). Extracting them enables direct unit testing. The entire gesture pipeline can be tested with synthetic landmark arrays -- no camera needed.

### Recommended Strategy

1. **Phase 1 (Foundation):** Vitest config + geometry.ts tests + extract & test classifyGrip/computeFingerCurl
2. **Phase 2 (Core):** Hook tests with synthetic poses for grip/gesture/collision
3. **Phase 3 (Physics):** useHandPhysics + useMotionRecognition with frame sequences
4. **Phase 4 (Integration):** Synthetic hand sequence -> verify object state changes

---

## Consolidated Action Plan (Priority Order)

### Wave 1: Stabilize (Performance + Testing Foundation)

1. Extract `useInteractionController` from App.tsx
2. Move interaction loop to RAF + refs (stop setState per frame)
3. Setup vitest, write geometry.ts tests
4. Extract and test classifyGrip, computeFingerCurl, resolveCollisions
5. Add `telemetry/` to .gitignore

### Wave 2: Harden (Security + Architecture)

6. Self-host MediaPipe WASM + model (eliminate CDN dependency)
7. Add CSP meta tag to index.html
8. Cap gestureEvents array (prevent DoS)
9. Implement GestureActionMap (command pattern)
10. Unify grip state sources

### Wave 3: Polish (Quality + Scalability)

11. Delete dead code (MacWindow, WorkspaceCanvas, TelemetryHUD)
12. Throttle telemetry UI to 10fps
13. Ring buffer for timelineEntries
14. Hook tests with synthetic poses (P1 cases)
15. Add privacy consent for telemetry recording
