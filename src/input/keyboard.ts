/**
 * STREAM D — Keyboard input source
 *
 * Key mapping (event.code, layout-agnostic):
 *   KeyW / KeyS      pitch  -1 / +1   (W = nose down, push forward = dive)
 *   KeyA / KeyD      roll   -1 / +1
 *   KeyQ / KeyE      yaw    -1 / +1
 *   ShiftLeft/Right  throttle 1 (hold)
 *   Space            throttle 1 (hold)
 *   ControlLeft/Right throttle 0 (overrides Shift/Space)
 *   (neither held)   throttle 0.5  — hover-friendly default
 *   KeyR             reset       (edge-triggered)
 *   Tab              modeToggle  (edge-triggered, preventDefault)
 */
import type { InputState } from '../shared/types.ts';

// ── Key-to-axis mapping ────────────────────────────────────────────────────
const KEY_PITCH_NEG = 'KeyW';
const KEY_PITCH_POS = 'KeyS';
const KEY_ROLL_NEG  = 'KeyA';
const KEY_ROLL_POS  = 'KeyD';
const KEY_YAW_NEG   = 'KeyQ';
const KEY_YAW_POS   = 'KeyE';

const KEY_THROTTLE_HIGH: readonly string[] = ['ShiftLeft', 'ShiftRight', 'Space'];
const KEY_THROTTLE_LOW:  readonly string[] = ['ControlLeft', 'ControlRight'];

const KEY_RESET       = 'KeyR';
const KEY_MODE_TOGGLE = 'Tab';

/** Default throttle when no throttle key is held (hover-friendly). */
const THROTTLE_HOVER = 0.5;

export interface InputSource {
  attach(): void;
  detach(): void;
  /**
   * Latest state. modeToggle/reset are edge-triggered: true ONCE per press,
   * then auto-cleared after composer calls clearEdges().
   */
  read(): InputState;
  /** Called by the composer after blending to clear edge-triggered flags. */
  clearEdges(): void;
}

export function createKeyboardSource(): InputSource {
  const held = new Set<string>();
  let pendingReset      = false;
  let pendingModeToggle = false;

  function onKeyDown(e: KeyboardEvent): void {
    held.add(e.code);

    if (e.code === KEY_RESET) {
      pendingReset = true;
    }
    if (e.code === KEY_MODE_TOGGLE) {
      pendingModeToggle = true;
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    held.delete(e.code);
  }

  function read(): InputState {
    // ── Pitch ────────────────────────────────────────────────────────────
    let pitch = 0;
    if (held.has(KEY_PITCH_NEG)) pitch -= 1;
    if (held.has(KEY_PITCH_POS)) pitch += 1;

    // ── Roll ─────────────────────────────────────────────────────────────
    let roll = 0;
    if (held.has(KEY_ROLL_NEG)) roll -= 1;
    if (held.has(KEY_ROLL_POS)) roll += 1;

    // ── Yaw ──────────────────────────────────────────────────────────────
    let yaw = 0;
    if (held.has(KEY_YAW_NEG)) yaw -= 1;
    if (held.has(KEY_YAW_POS)) yaw += 1;

    // ── Throttle ─────────────────────────────────────────────────────────
    const lowHeld  = KEY_THROTTLE_LOW.some(k  => held.has(k));
    const highHeld = KEY_THROTTLE_HIGH.some(k => held.has(k));
    let throttle: number;
    if (lowHeld) {
      throttle = 0;           // Ctrl overrides everything
    } else if (highHeld) {
      throttle = 1;           // Shift or Space = full throttle
    } else {
      throttle = THROTTLE_HOVER; // neither held → gentle hover
    }

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
    pendingReset      = false;
    pendingModeToggle = false;
  }

  function attach(): void {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
  }

  function detach(): void {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup',   onKeyUp);
    held.clear();
    pendingReset      = false;
    pendingModeToggle = false;
  }

  return { attach, detach, read, clearEdges };
}
