/**
 * STREAM D — Gamepad input source (Standard mapping, Mode 2)
 *
 * Axis mapping:
 *   axes[0]  left stick X   → yaw   (-1 = left, +1 = right)
 *   axes[1]  left stick Y   → throttle
 *             Browser: -1 = stick up, +1 = stick down.
 *             Pilot convention: stick all-down = 0, stick center = 0.5, stick up = 1.
 *             Formula: throttle = (1 - axes[1]) / 2
 *             axes[1] = -1 (up)   → (1 - (-1)) / 2 = 1.0  ✓
 *             axes[1] =  0 (ctr)  → (1 -   0 ) / 2 = 0.5  ✓
 *             axes[1] = +1 (down) → (1 -   1 ) / 2 = 0.0  ✓
 *   axes[2]  right stick X  → roll  (-1 = left, +1 = right)
 *   axes[3]  right stick Y  → pitch
 *             Browser: -1 = stick up (push forward), +1 = stick down.
 *             Pilot push-forward = nose down = pitch -1.
 *             Formula: pitch = axes[3]   (no inversion needed)
 *
 * Button mapping:
 *   buttons[8]  (Select / Back) → modeToggle (rising edge)
 *   buttons[9]  (Start)         → reset       (rising edge)
 *
 * Deadzone: 0.05 on each axis independently.
 */
import type { InputState } from '../shared/types.ts';
import type { InputSource } from './keyboard.ts';

const DEADZONE = 0.05;

function applyDeadzone(v: number): number {
  return Math.abs(v) < DEADZONE ? 0 : v;
}

export function createGamepadSource(): InputSource {
  // Track previous button state to detect rising edges
  let prevModeToggle = false;
  let prevReset      = false;
  let pendingModeToggle = false;
  let pendingReset      = false;

  function read(): InputState {
    const gamepads = navigator.getGamepads();
    // Use the first connected gamepad
    let gp: Gamepad | null = null;
    for (const g of gamepads) {
      if (g && g.connected) { gp = g; break; }
    }

    if (!gp) {
      return {
        throttle: 0.5, // neutral when no gamepad — don't fight other sources
        yaw:      0,
        pitch:    0,
        roll:     0,
        modeToggle: pendingModeToggle,
        reset:      pendingReset,
      };
    }

    const axes    = gp.axes;
    const buttons = gp.buttons;

    // ── Axes ─────────────────────────────────────────────────────────────
    const rawYaw      = applyDeadzone(axes[0] ?? 0);
    const rawThrottle = axes[1] ?? 0;          // no deadzone — center matters
    const rawRoll     = applyDeadzone(axes[2] ?? 0);
    const rawPitch    = axes[3] ?? 0;          // no deadzone on Y, invert below

    const yaw      = rawYaw;
    const throttle = (1 - rawThrottle) / 2;   // see header comment
    const roll     = rawRoll;
    const pitch    = applyDeadzone(rawPitch); // push forward (axes[3]=-1) → pitch -1 → nose down

    // ── Edge-triggered buttons ────────────────────────────────────────────
    const curModeToggle = buttons[8]?.pressed ?? false;
    const curReset      = buttons[9]?.pressed ?? false;

    if (curModeToggle && !prevModeToggle) pendingModeToggle = true;
    if (curReset      && !prevReset)      pendingReset      = true;

    prevModeToggle = curModeToggle;
    prevReset      = curReset;

    return {
      throttle,
      yaw,
      pitch,
      roll,
      modeToggle: pendingModeToggle,
      reset:      pendingReset,
    };
  }

  function clearEdges(): void {
    pendingModeToggle = false;
    pendingReset      = false;
  }

  function attach(): void {
    // Gamepad events (gamepadconnected/disconnected) are informational only —
    // we poll navigator.getGamepads() directly so no listeners are needed.
  }

  function detach(): void {
    prevModeToggle    = false;
    prevReset         = false;
    pendingModeToggle = false;
    pendingReset      = false;
  }

  return { attach, detach, read, clearEdges };
}
