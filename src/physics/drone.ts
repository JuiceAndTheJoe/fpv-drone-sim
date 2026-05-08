/**
 * STREAM B — Drone rigid body helpers
 *
 * The drone RigidBody is owned and managed by physicsWorld (world.ts).
 * This file exports the quaternion body→world rotation utility so it can
 * be reused by other modules (e.g. render for prop-disc orientation) without
 * importing Rapier directly.
 */

/**
 * Rotate a body-frame vector into world frame using the quaternion
 * q * v * q^-1.  Operates purely on numbers — no external deps required.
 *
 * @param qx,qy,qz,qw  - Rotation quaternion components (x,y,z,w)
 * @param vx,vy,vz      - Vector in body frame
 * @returns             - [x, y, z] in world frame
 */
export function quatRotateVec(
  qx: number, qy: number, qz: number, qw: number,
  vx: number, vy: number, vz: number,
): [number, number, number] {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}
