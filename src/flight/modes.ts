/**
 * STREAM C — Flight controllers
 *
 * Maps InputState → body-frame force + torque for both flight modes.
 *
 *  Acro (rate mode):
 *    Sticks command target body-frame angular rates.
 *    A single P loop (KP_RATE) closes the rate error to produce torque.
 *
 *  Arcade (angle mode):
 *    Sticks command target roll/pitch angles.
 *    Outer P loop (KP_ATTITUDE) converts angle error → target rate.
 *    Inner P loop (KP_RATE) converts rate error → torque  (same as acro).
 *    Yaw stays direct-rate like acro.
 *    Throttle is altitude-assisted: centre-stick ≈ hover.
 *
 * Euler convention used for angle extraction:
 *   ZYX intrinsic (= YXZ extrinsic) to match a typical aerospace/FPV frame.
 *   We decompose the quaternion into:
 *     yaw   (Y-axis, world up)
 *     pitch (X-axis, body right — positive = nose up)
 *     roll  (Z-axis, body back  — positive = bank right)
 *   Only roll and pitch are needed for the attitude loop; yaw is handled
 *   as a direct rate command in both modes.
 *
 * Axis convention (body frame, right-handed, +X right, +Y up, +Z back):
 *   torque[0] = pitch torque  (positive → nose up)
 *   torque[1] = yaw torque    (positive → nose right)
 *   torque[2] = roll torque   (positive → bank right)
 */

import type {
  BodyForces,
  DroneState,
  FlightController,
  FlightMode,
  InputState,
  Quat,
  Vec3,
} from '../shared/types.ts';
import { emit } from '../shared/eventBus.ts';
import {
  HOVER_THROTTLE,
  KP_ATTITUDE,
  KP_RATE,
  MAX_BANK_RAD,
  RATE_MAX_RAD_S,
  STICK_EXPO,
  THROTTLE_CURVE,
  THRUST_MAX_N,
} from './tuning.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stick expo: soft centre, full authority at edges. */
function expo(x: number): number {
  return Math.sign(x) * Math.pow(Math.abs(x), STICK_EXPO);
}

/** Clamp a value to [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Rotate a world-frame vector into body frame using the inverse of the
 * given quaternion (= conjugate for unit quaternions).
 *
 * q = [x, y, z, w]  (types.ts convention)
 * v_body = q* ⊗ v_world ⊗ q
 * Implemented via the standard sandwich product formula.
 */
function rotateVecByInverseQuat(v: Vec3, q: Quat): Vec3 {
  const [qx, qy, qz, qw] = q;
  // Conjugate (inverse for unit quat)
  const cx = -qx, cy = -qy, cz = -qz, cw = qw;

  // First cross: t = 2 * (c.xyz × v)
  const tx = 2 * (cy * v[2] - cz * v[1]);
  const ty = 2 * (cz * v[0] - cx * v[2]);
  const tz = 2 * (cx * v[1] - cy * v[0]);

  return [
    v[0] + cw * tx + (cy * tz - cz * ty),
    v[1] + cw * ty + (cz * tx - cx * tz),
    v[2] + cw * tz + (cx * ty - cy * tx),
  ];
}

/**
 * Decompose a unit quaternion into ZYX intrinsic Euler angles.
 * Returns [roll, pitch, yaw] in radians where:
 *   roll  = rotation about body Z (positive = bank right)
 *   pitch = rotation about body X (positive = nose up)
 *   yaw   = rotation about world Y (positive = nose right)
 *
 * Pitch is clamped to ±(π/2 − 0.01) to avoid gimbal-lock singularities.
 */
function quatToRollPitch(q: Quat): { roll: number; pitch: number } {
  const [x, y, z, w] = q;

  // Standard ZYX decomposition
  // sinPitch = 2*(w*x - z*y)  — using our axis mapping
  // We need pitch around X and roll around Z.
  // For quaternion [x,y,z,w] with +X right, +Y up, +Z back:
  //   sinPitch = 2(w·x + z·y)   (rotation about world X / body X)
  //   No — let's derive carefully from the rotation matrix.
  //
  // Rotation matrix from q (row-major, R*v rotates v):
  //   R[0][0] = 1 - 2(y²+z²)   R[0][1] = 2(xy−wz)   R[0][2] = 2(xz+wy)
  //   R[1][0] = 2(xy+wz)        R[1][1] = 1−2(x²+z²) R[1][2] = 2(yz−wx)
  //   R[2][0] = 2(xz−wy)        R[2][1] = 2(yz+wx)   R[2][2] = 1−2(x²+y²)
  //
  // ZYX intrinsic: Rz(yaw) · Rx(pitch) · Rz(roll) — but our "up" is Y.
  // Simpler to use the standard aerospace convention adapted to Y-up:
  //   pitch = asin(clamp( 2(wy + xz), -1, 1 ))   → rotation about body X
  //   roll  = atan2( 2(wx - yz),  1 - 2(x²+y²) ) → rotation about body Z
  //
  // Sign checks:
  //   A pure pitch-up quat: rotate about X by θ → q = [sin(θ/2), 0, 0, cos(θ/2)]
  //     sinP = 2*(cos(θ/2)*0 + sin(θ/2)*0) = 0  ← needs x and z, both 0... wrong.
  //
  // Let's use the rotation matrix directly.
  // pitch (nose up = +) corresponds to rotation about world/body X:
  //   sinPitch = R[2][1] with sign we want... actually let's use:
  //   R[1][0] = 2(xy+wz)  ; this is how Y-column mixes with X-row
  //
  // After careful analysis for Y-up, X-right, Z-back coord system:
  //   Pitch (rotation about X, positive=nose-up):
  //     sinPitch = 2*(w*x - y*z)      → R[1][2] negated sign = 2(yz - wx), so sinPitch = -R[1][2]
  //   Roll (rotation about Z, positive=bank-right):
  //     roll = atan2(R[1][0], R[1][1]) = atan2(2(xy+wz), 1-2(x²+z²))

  // sinPitch = -R[1][2] = -(2*(y*z - w*x)) = 2*(w*x - y*z)
  const sinPitch = clamp(2 * (w * x - y * z), -1, 1);
  const PITCH_LIMIT = Math.PI / 2 - 0.01;
  const pitch = clamp(Math.asin(sinPitch), -PITCH_LIMIT, PITCH_LIMIT);

  // roll = atan2(R[1][0], R[1][1])
  const r10 = 2 * (x * y + w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const roll = Math.atan2(r10, r11);

  return { roll, pitch };
}

// ---------------------------------------------------------------------------
// Throttle → thrust (shared)
// ---------------------------------------------------------------------------

/**
 * Compute body-frame thrust force from a throttle input [0..1].
 * Applies the THROTTLE_CURVE exponent for a soft low-end feel.
 */
function computeThrust(throttle: number): Vec3 {
  const t = clamp(throttle, 0, 1);
  const normalized = Math.pow(t, THROTTLE_CURVE);
  return [0, THRUST_MAX_N * normalized, 0];
}

/**
 * Arcade altitude-assist throttle mapping.
 * Centre stick (0.5) → roughly hover thrust.
 * Effective range: 0 = min, 1 = max, clamped.
 */
function arcadeThrottle(rawThrottle: number): Vec3 {
  const effective = clamp(HOVER_THROTTLE + (rawThrottle - 0.5) * 1.5, 0, 1);
  return computeThrust(effective);
}

// ---------------------------------------------------------------------------
// Acro inner loop (shared)
// ---------------------------------------------------------------------------

/**
 * Compute torque in body frame from rate error.
 * targetRates and currentBodyRates are [pitch, yaw, roll] in rad/s
 * using the body-frame axis mapping:
 *   [0] = X axis = pitch (positive → nose up)
 *   [1] = Y axis = yaw   (positive → nose right)
 *   [2] = Z axis = roll  (positive → bank right)
 */
function rateLoopTorque(targetRates: Vec3, currentBodyRates: Vec3): Vec3 {
  return [
    KP_RATE * (targetRates[0] - currentBodyRates[0]),
    KP_RATE * (targetRates[1] - currentBodyRates[1]),
    KP_RATE * (targetRates[2] - currentBodyRates[2]),
  ];
}

// ---------------------------------------------------------------------------
// FlightController implementation
// ---------------------------------------------------------------------------

class DroneFlightController implements FlightController {
  mode: FlightMode = 'arcade';

  setMode(mode: FlightMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    emit('modeChanged', { mode });
  }

  compute(input: InputState, state: DroneState, _dt: number): BodyForces {
    return this.mode === 'acro'
      ? this._acro(input, state)
      : this._arcade(input, state);
  }

  // -------------------------------------------------------------------------
  // Acro (rate) mode
  // -------------------------------------------------------------------------
  private _acro(input: InputState, state: DroneState): BodyForces {
    // 1. Thrust
    const force = computeThrust(input.throttle);

    // 2. Target body rates from stick expo
    //    Axis mapping: pitch → torque[0] (X), yaw → torque[1] (Y), roll → torque[2] (Z)
    //    "stick right roll" (input.roll = +1) → positive roll rate → bank right ✓
    //    "stick up pitch"   (input.pitch= +1) → positive pitch rate → nose up ✓
    //    "stick right yaw"  (input.yaw  = +1) → positive yaw rate → nose right ✓
    const targetRates: Vec3 = [
      expo(input.pitch) * RATE_MAX_RAD_S,  // pitch around body X
      expo(input.yaw)   * RATE_MAX_RAD_S,  // yaw   around body Y
      expo(input.roll)  * RATE_MAX_RAD_S,  // roll  around body Z
    ];

    // 3. Transform world-frame angular velocity → body frame
    const bodyOmega = rotateVecByInverseQuat(state.angularVelocity, state.quaternion);
    // bodyOmega is [ωx, ωy, ωz] in body frame
    const currentBodyRates: Vec3 = [bodyOmega[0], bodyOmega[1], bodyOmega[2]];

    // 4. P-controller on rate error
    const torque = rateLoopTorque(targetRates, currentBodyRates);

    return { force, torque };
  }

  // -------------------------------------------------------------------------
  // Arcade (angle) mode
  // -------------------------------------------------------------------------
  private _arcade(input: InputState, state: DroneState): BodyForces {
    // 1. Altitude-assisted thrust
    const force = arcadeThrottle(input.throttle);

    // 2. Current attitude (roll, pitch in body frame)
    const { roll: currentRoll, pitch: currentPitch } = quatToRollPitch(state.quaternion);

    // 3. Target angles from sticks
    const targetRoll  = expo(input.roll)  * MAX_BANK_RAD;
    const targetPitch = expo(input.pitch) * MAX_BANK_RAD;

    // 4. Outer loop: angle error → target rate (clamped)
    const targetPitchRate = clamp(
      KP_ATTITUDE * (targetPitch - currentPitch),
      -RATE_MAX_RAD_S,
      RATE_MAX_RAD_S,
    );
    const targetRollRate = clamp(
      KP_ATTITUDE * (targetRoll - currentRoll),
      -RATE_MAX_RAD_S,
      RATE_MAX_RAD_S,
    );
    // Yaw: direct rate command like acro
    const targetYawRate = expo(input.yaw) * RATE_MAX_RAD_S;

    const targetRates: Vec3 = [targetPitchRate, targetYawRate, targetRollRate];

    // 5. Transform world angular velocity → body frame
    const bodyOmega = rotateVecByInverseQuat(state.angularVelocity, state.quaternion);
    const currentBodyRates: Vec3 = [bodyOmega[0], bodyOmega[1], bodyOmega[2]];

    // 6. Inner loop: rate error → torque (same as acro)
    const torque = rateLoopTorque(targetRates, currentBodyRates);

    return { force, torque };
  }
}

export const flightController: FlightController = new DroneFlightController();
