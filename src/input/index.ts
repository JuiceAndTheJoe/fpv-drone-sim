/**
 * STREAM D — Input layer composer
 *
 * Owns three sources: keyboard, gamepad, touch.
 * sample() blends them per-axis using "most recent non-zero wins" within a
 * 250 ms freshness window. Priority tie-break: touch > gamepad > keyboard.
 *
 * modeToggle and reset are OR-merged across all sources, then edge flags are
 * cleared on all sources after the blend is returned.
 */
import type { InputProvider, InputState } from '../shared/types.ts';
import { createKeyboardSource } from './keyboard.ts';
import { createGamepadSource }  from './gamepad.ts';
import { createTouchSource }    from './touch.ts';

/** How long (ms) a non-zero axis reading is considered "fresh". */
const RECENCY_WINDOW_MS = 250;

interface AxisTimestamps {
  throttle: number;
  yaw:      number;
  pitch:    number;
  roll:     number;
}

const ZERO_STAMPS = (): AxisTimestamps => ({ throttle: 0, yaw: 0, pitch: 0, roll: 0 });

const NEUTRAL: InputState = {
  throttle: 0.5, // idle hover
  yaw:      0,
  pitch:    0,
  roll:     0,
  modeToggle: false,
  reset:      false,
};

// ── Per-source timestamp trackers ──────────────────────────────────────────
const kbStamps:  AxisTimestamps = ZERO_STAMPS();
const gpStamps:  AxisTimestamps = ZERO_STAMPS();
const tStamps:   AxisTimestamps = ZERO_STAMPS();

type AxisKey = keyof AxisTimestamps;
const AXES: readonly AxisKey[] = ['throttle', 'yaw', 'pitch', 'roll'];

function isNonZero(axis: AxisKey, state: InputState): boolean {
  if (axis === 'throttle') {
    // Throttle non-zero means "intentionally set" → any deviation from neutral (0.5) counts.
    // But for keyboard the default is 0.5, so treat it as "active" only when a key is held.
    // We check magnitude > 0.05 from center for gamepad/touch, but for blending purposes
    // we simply check whether the value differs from the hover neutral by a meaningful amount.
    return Math.abs(state.throttle - 0.5) > 0.05;
  }
  return Math.abs(state[axis]) > 0.02;
}

/**
 * Pick the winning value for one axis given three candidates and their
 * freshness timestamps. Priority: touch > gamepad > keyboard (tie-break).
 */
function pickAxis(
  axis: AxisKey,
  now:   number,
  kbVal: number, gpVal: number, tVal: number,
): number {
  // Freshen timestamps for any source that moved this tick
  // (called before this function — see sample())

  const kbAge = now - kbStamps[axis];
  const gpAge = now - gpStamps[axis];
  const tAge  = now - tStamps[axis];

  // Build list of candidates that are within the freshness window
  type Candidate = { val: number; age: number; pri: number };
  const candidates: Candidate[] = [];

  if (kbAge <= RECENCY_WINDOW_MS) candidates.push({ val: kbVal, age: kbAge, pri: 0 });
  if (gpAge <= RECENCY_WINDOW_MS) candidates.push({ val: gpVal, age: gpAge, pri: 1 });
  if (tAge  <= RECENCY_WINDOW_MS) candidates.push({ val: tVal,  age: tAge,  pri: 2 });

  if (candidates.length === 0) {
    // No source was fresh; return axis-specific neutral
    return axis === 'throttle' ? 0.5 : 0;
  }

  // Sort: most recent first, then higher priority (touch > gamepad > keyboard)
  candidates.sort((a, b) => {
    const ageDiff = a.age - b.age;
    if (Math.abs(ageDiff) > 16) return ageDiff; // >1 frame apart → prefer fresher
    return b.pri - a.pri;                        // same-frame: priority wins
  });

  return candidates[0].val;
}

// ── Source instances ────────────────────────────────────────────────────────
const kb = createKeyboardSource();
const gp = createGamepadSource();
const tc = createTouchSource();

// ── InputProvider export ────────────────────────────────────────────────────
export const input: InputProvider = {
  attach(): void {
    kb.attach();
    gp.attach();
    tc.attach();
  },

  detach(): void {
    kb.detach();
    gp.detach();
    tc.detach();
  },

  sample(): InputState {
    const now  = performance.now();
    const kbS  = kb.read();
    const gpS  = gp.read();
    const tS   = tc.read();

    // Update freshness timestamps for non-zero axes this tick
    for (const axis of AXES) {
      if (isNonZero(axis, kbS)) kbStamps[axis] = now;
      if (isNonZero(axis, gpS)) gpStamps[axis] = now;
      if (isNonZero(axis, tS))  tStamps[axis]  = now;
    }

    const throttle = pickAxis('throttle', now, kbS.throttle, gpS.throttle, tS.throttle);
    const yaw      = pickAxis('yaw',      now, kbS.yaw,      gpS.yaw,      tS.yaw);
    const pitch    = pickAxis('pitch',    now, kbS.pitch,    gpS.pitch,    tS.pitch);
    const roll     = pickAxis('roll',     now, kbS.roll,     gpS.roll,     tS.roll);

    const modeToggle = kbS.modeToggle || gpS.modeToggle || tS.modeToggle;
    const reset      = kbS.reset      || gpS.reset      || tS.reset;

    // Clear edge flags on all sources
    kb.clearEdges();
    gp.clearEdges();
    tc.clearEdges();

    return { throttle, yaw, pitch, roll, modeToggle, reset };
  },
};

// Keep NEUTRAL in scope to avoid "unused variable" warning — it documents the
// shape but is not used at runtime (pickAxis returns per-axis neutrals inline).
void (NEUTRAL satisfies InputState);
