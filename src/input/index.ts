/**
 * STREAM D — Input layer
 * Owner: TBD
 *
 * Composes keyboard + gamepad + touch into a single InputState.
 * Priority: touch > gamepad > keyboard, blended per-axis by recency.
 */
import type { InputProvider, InputState } from '../shared/types.ts';

const NEUTRAL: InputState = {
  throttle: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  modeToggle: false,
  reset: false,
};

export const input: InputProvider = {
  sample(): InputState {
    return { ...NEUTRAL };
  },
  attach(): void {
    // TODO(stream-d): wire keyboard.ts, gamepad.ts, touch.ts
  },
  detach(): void {
    // TODO(stream-d)
  },
};
