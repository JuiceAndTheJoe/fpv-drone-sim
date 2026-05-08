/**
 * STREAM B — Physics world
 * Owner: Stream B
 *
 * Wraps Rapier3D in the PhysicsWorld interface so the rest of the engine
 * never imports Rapier directly. init() must be awaited (WASM is async).
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
  PHYSICS_DT,
  QUADRATIC_DRAG,
  SPAWN_POSITION,
} from '../shared/constants.ts';
import { emit } from '../shared/eventBus.ts';
import type { RigidBody, World as RapierWorld } from '@dimforge/rapier3d-compat';

// ---------------------------------------------------------------------------
// Quaternion helpers — inline so we don't add Three.js as a runtime dep.
// Rotates a body-frame vector into world frame using q * v * q^-1.
// q is [x, y, z, w], v is [x, y, z].
// ---------------------------------------------------------------------------
function quatRotateVec(
  qx: number, qy: number, qz: number, qw: number,
  vx: number, vy: number, vz: number,
): [number, number, number] {
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  // result = v + qw * t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

// ---------------------------------------------------------------------------
// Internal mutable state (module-level so init() can wire it up once)
// ---------------------------------------------------------------------------
let rapierWorld: RapierWorld | null = null;
let droneBody: RigidBody | null = null;

// Last commanded throttle (0..1) — drives the RPM proxy.
let _throttle = 0;
// Smoothed RPM proxy (0..1).
let _rpm = 0;
// RPM smoothing time-constant (seconds to reach ~63 % of target).
const RPM_TAU = 0.08;

// ---------------------------------------------------------------------------
// Public PhysicsWorld implementation
// ---------------------------------------------------------------------------
export const physicsWorld: PhysicsWorld = {
  async init(): Promise<void> {
    const RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();

    // Build world with -Y gravity
    rapierWorld = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    rapierWorld.timestep = PHYSICS_DT;

    // ---- Static ground plane ----
    // A large cuboid centred at y = GROUND_Y acts as the floor.
    const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, GROUND_Y, 0);
    const groundBody = rapierWorld.createRigidBody(groundDesc);
    // Half-extents: very thin slab, wide enough to catch any fall.
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(500, 0.05, 500);
    rapierWorld.createCollider(groundColliderDesc, groundBody);

    // ---- Dynamic drone body ----
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...SPAWN_POSITION)
      .setLinearDamping(LINEAR_DRAG)
      .setAngularDamping(ANGULAR_DRAG)
      // setAdditionalMass adds on top of the collider's density-derived mass.
      // We set density=0 on the collider and provide the total mass here.
      .setAdditionalMass(MASS_KG);

    droneBody = rapierWorld.createRigidBody(bodyDesc);

    // Attach box collider with zero density (mass fully controlled above).
    const [hx, hy, hz] = DRONE_HALF_EXTENTS;
    const droneColliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setDensity(0);
    rapierWorld.createCollider(droneColliderDesc, droneBody);
  },

  step(_dt: number): void {
    if (!rapierWorld || !droneBody) return;

    // Smooth the RPM proxy toward the last commanded throttle.
    // Discrete first-order low-pass: alpha = dt / (tau + dt)
    const alpha = PHYSICS_DT / (RPM_TAU + PHYSICS_DT);
    _rpm += alpha * (_throttle - _rpm);

    // Apply quadratic drag in world space each step.
    // F_drag = -QUADRATIC_DRAG * |v| * v
    const vel = droneBody.linvel();
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    if (speed > 0) {
      const k = -QUADRATIC_DRAG * speed;
      droneBody.addForce({ x: k * vel.x, y: k * vel.y, z: k * vel.z }, true);
    }

    // Advance the simulation by one fixed step.
    rapierWorld.step();

    // Auto-reset if the drone falls through the floor.
    const pos = droneBody.translation();
    if (pos.y < FALL_RESET_Y) {
      physicsWorld.resetDrone([...SPAWN_POSITION] as Vec3);
      emit('reset', undefined);
    }
  },

  getDroneState(): DroneState {
    if (!droneBody) {
      return {
        position: [...SPAWN_POSITION] as Vec3,
        quaternion: [0, 0, 0, 1],
        linearVelocity: [0, 0, 0],
        angularVelocity: [0, 0, 0],
        throttle: _throttle,
        rpm: _rpm,
      };
    }

    const pos = droneBody.translation();
    const rot = droneBody.rotation();
    const lv = droneBody.linvel();
    const av = droneBody.angvel();

    return {
      position: [pos.x, pos.y, pos.z],
      quaternion: [rot.x, rot.y, rot.z, rot.w],
      linearVelocity: [lv.x, lv.y, lv.z],
      angularVelocity: [av.x, av.y, av.z],
      throttle: _throttle,
      rpm: _rpm,
    };
  },

  applyBodyForce(force: Vec3): void {
    if (!droneBody) return;

    // Infer throttle from the Y component of the body-frame force.
    // hover force = MASS_KG * GRAVITY; normalise into 0..1.
    const hoverForce = MASS_KG * GRAVITY;
    _throttle = Math.max(0, Math.min(1, force[1] / (hoverForce * 2)));

    // Transform body-frame force to world frame via current orientation.
    const rot = droneBody.rotation();
    const [wx, wy, wz] = quatRotateVec(rot.x, rot.y, rot.z, rot.w, force[0], force[1], force[2]);
    droneBody.addForce({ x: wx, y: wy, z: wz }, true);
  },

  applyBodyTorque(torque: Vec3): void {
    if (!droneBody) return;

    // Transform body-frame torque to world frame.
    const rot = droneBody.rotation();
    const [wx, wy, wz] = quatRotateVec(rot.x, rot.y, rot.z, rot.w, torque[0], torque[1], torque[2]);
    droneBody.addTorque({ x: wx, y: wy, z: wz }, true);
  },

  resetDrone(position: Vec3): void {
    if (!droneBody) return;

    droneBody.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    droneBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    droneBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    droneBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    _throttle = 0;
    _rpm = 0;
  },
};
