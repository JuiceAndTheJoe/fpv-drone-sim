/**
 * STREAM B — Physics world (pure-TS, no Rapier/WASM)
 *
 * Semi-implicit Euler integrator with analytic drag.
 * All vectors are world-frame unless noted as "body-frame".
 */
import type { DroneState, PhysicsWorld, Vec3 } from '../shared/types.ts';
import {
  ANGULAR_DRAG,
  DRONE_HALF_EXTENTS,
  FALL_RESET_Y,
  GRAVITY,
  GROUND_Y,
  LINEAR_DRAG,
  MASS_KG,
  QUADRATIC_DRAG,
  SPAWN_POSITION,
} from '../shared/constants.ts';
import { emit } from '../shared/eventBus.ts';
import { quatRotateVec } from './drone.ts';

// Principal inertia: mass concentrated at 10 cm moment arm on a 5" quad.
// I = MASS_KG * r²,  r = 0.10 m  →  5e-3 kg·m²
const I = MASS_KG * 0.10 * 0.10;
const INV_I = 1 / I;

// Mutable rigid-body state (module-level; init() seeds these)
let px = SPAWN_POSITION[0], py = SPAWN_POSITION[1], pz = SPAWN_POSITION[2];
let vx = 0, vy = 0, vz = 0;
// Quaternion (x, y, z, w)
let qx = 0, qy = 0, qz = 0, qw = 1;
let wx = 0, wy = 0, wz = 0; // angular velocity (world frame, rad/s)

// Accumulated body-frame force and torque — cleared each step.
let fBx = 0, fBy = 0, fBz = 0;
let tBx = 0, tBy = 0, tBz = 0;

// Throttle / RPM bookkeeping
let _throttle = 0;
let _rpm = 0;
const RPM_TAU = 0.08;

export const physicsWorld: PhysicsWorld = {
  init(): Promise<void> {
    px = SPAWN_POSITION[0]; py = SPAWN_POSITION[1]; pz = SPAWN_POSITION[2];
    vx = vy = vz = 0;
    qx = qy = qz = 0; qw = 1;
    wx = wy = wz = 0;
    fBx = fBy = fBz = 0;
    tBx = tBy = tBz = 0;
    _throttle = 0; _rpm = 0;
    return Promise.resolve();
  },

  step(dt: number): void {
    // RPM low-pass toward commanded throttle
    const alpha = dt / (RPM_TAU + dt);
    _rpm += alpha * (_throttle - _rpm);

    // Rotate body-frame force/torque into world frame
    const [fWx, fWy, fWz] = quatRotateVec(qx, qy, qz, qw, fBx, fBy, fBz);
    const [tWx, tWy, tWz] = quatRotateVec(qx, qy, qz, qw, tBx, tBy, tBz);

    // Clear buffers (mirrors Rapier's per-step accumulator model)
    fBx = fBy = fBz = 0;
    tBx = tBy = tBz = 0;

    // Aggregate forces (world frame)
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    let Fx = fWx;
    let Fy = fWy - GRAVITY * MASS_KG;
    let Fz = fWz;
    Fx -= LINEAR_DRAG * vx;
    Fy -= LINEAR_DRAG * vy;
    Fz -= LINEAR_DRAG * vz;
    if (speed > 0) {
      Fx -= QUADRATIC_DRAG * speed * vx;
      Fy -= QUADRATIC_DRAG * speed * vy;
      Fz -= QUADRATIC_DRAG * speed * vz;
    }

    // Aggregate torques (world frame)
    const Tx = tWx - ANGULAR_DRAG * wx;
    const Ty = tWy - ANGULAR_DRAG * wy;
    const Tz = tWz - ANGULAR_DRAG * wz;

    // Semi-implicit Euler: velocities first, then positions
    const invM = 1 / MASS_KG;
    vx += Fx * invM * dt;
    vy += Fy * invM * dt;
    vz += Fz * invM * dt;

    px += vx * dt;
    py += vy * dt;
    pz += vz * dt;

    wx += Tx * INV_I * dt;
    wy += Ty * INV_I * dt;
    wz += Tz * INV_I * dt;

    // Quaternion integration: q += 0.5 * Ω ⊗ q * dt with Ω = (wx, wy, wz, 0)
    const dqx = 0.5 * dt * ( wx * qw + wy * qz - wz * qy);
    const dqy = 0.5 * dt * (-wx * qz + wy * qw + wz * qx);
    const dqz = 0.5 * dt * ( wx * qy - wy * qx + wz * qw);
    const dqw = 0.5 * dt * (-wx * qx - wy * qy - wz * qz);
    qx += dqx; qy += dqy; qz += dqz; qw += dqw;
    const qlen = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
    if (qlen > 0) { qx /= qlen; qy /= qlen; qz /= qlen; qw /= qlen; }

    // Ground collision — bottom of the body sits at p.y - hy
    const groundLimit = GROUND_Y + DRONE_HALF_EXTENTS[1];
    if (py < groundLimit) {
      py = groundLimit;
      if (vy < 0) vy = 0;
    }

    // Fall-through auto-reset (defensive — ground clamp should make this unreachable)
    if (py < FALL_RESET_Y) {
      physicsWorld.resetDrone([...SPAWN_POSITION] as Vec3);
      emit('reset', undefined);
    }
  },

  getDroneState(): DroneState {
    return {
      position: [px, py, pz],
      quaternion: [qx, qy, qz, qw],
      linearVelocity: [vx, vy, vz],
      angularVelocity: [wx, wy, wz],
      throttle: _throttle,
      rpm: _rpm,
    };
  },

  applyBodyForce(force: Vec3): void {
    // Infer throttle from body-Y thrust vs. twice the hover force.
    const hoverForce = MASS_KG * GRAVITY;
    _throttle = Math.max(0, Math.min(1, force[1] / (hoverForce * 2)));

    fBx += force[0];
    fBy += force[1];
    fBz += force[2];
  },

  applyBodyTorque(torque: Vec3): void {
    tBx += torque[0];
    tBy += torque[1];
    tBz += torque[2];
  },

  resetDrone(position: Vec3): void {
    px = position[0]; py = position[1]; pz = position[2];
    vx = vy = vz = 0;
    qx = qy = qz = 0; qw = 1;
    wx = wy = wz = 0;
    fBx = fBy = fBz = 0;
    tBx = tBy = tBz = 0;
    _throttle = 0;
    _rpm = 0;
  },
};
