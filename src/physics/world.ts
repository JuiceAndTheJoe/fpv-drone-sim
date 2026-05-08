/**
 * STREAM B — Physics world
 * Owner: TBD
 *
 * Wraps Rapier3D in the PhysicsWorld interface so the rest of the engine
 * never imports Rapier directly. Init() must be awaited (WASM is async).
 */
import type { DroneState, PhysicsWorld, Vec3 } from '../shared/types.ts';
import { SPAWN_POSITION } from '../shared/constants.ts';

const ZERO_STATE: DroneState = {
  position: [...SPAWN_POSITION] as Vec3,
  quaternion: [0, 0, 0, 1],
  linearVelocity: [0, 0, 0],
  angularVelocity: [0, 0, 0],
  throttle: 0,
  rpm: 0,
};

export const physicsWorld: PhysicsWorld = {
  async init(): Promise<void> {
    // TODO(stream-b): await RAPIER.init(); build world, ground, drone body
  },
  step(_dt: number): void {
    // TODO(stream-b)
  },
  getDroneState(): DroneState {
    return {
      ...ZERO_STATE,
      position: [...ZERO_STATE.position] as Vec3,
      quaternion: [...ZERO_STATE.quaternion] as [number, number, number, number],
      linearVelocity: [...ZERO_STATE.linearVelocity] as Vec3,
      angularVelocity: [...ZERO_STATE.angularVelocity] as Vec3,
    };
  },
  applyBodyForce(_force: Vec3): void {
    // TODO(stream-b)
  },
  applyBodyTorque(_torque: Vec3): void {
    // TODO(stream-b)
  },
  resetDrone(_position: Vec3): void {
    // TODO(stream-b)
  },
};
