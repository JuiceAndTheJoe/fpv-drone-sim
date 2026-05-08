/**
 * STREAM C — Flight tuning
 *
 * Tweak these to change feel. Numbers below target a 5" race quad:
 *   - Thrust-to-weight ~3:1
 *   - Max rate ~14 rad/s (~800°/s)
 */

/** Maximum thrust (N) at full throttle. T/W ≈ 3 with mass 0.5 kg. */
export const THRUST_MAX_N = 15;

/** Acro: max body-frame angular rate the sticks can command (rad/s). */
export const RATE_MAX_RAD_S = 14;

/** Stick expo curve exponent. 1 = linear, higher = softer center. */
export const STICK_EXPO = 2.5;

/** Acro rate-loop gain (N·m per rad/s of rate error). */
export const KP_RATE = 0.04;

/** Arcade attitude-loop gain (rad/s per rad of attitude error). */
export const KP_ATTITUDE = 6;

/** Arcade max bank angle (rad). */
export const MAX_BANK_RAD = Math.PI / 3;

/** Throttle curve exponent (1 = linear, >1 = soft low-end). */
export const THROTTLE_CURVE = 1.5;
