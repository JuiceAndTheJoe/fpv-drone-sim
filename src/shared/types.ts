/**
 * Shared type contracts for the FPV drone simulator.
 *
 * These interfaces are the single source of truth that every parallel work
 * stream develops against. Do not change them without coordinating across
 * streams (physics, flight, input, render, world, ui, audio).
 */

export type FlightMode = 'arcade' | 'acro';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

/** Normalized control input for a single tick. */
export interface InputState {
  /** 0..1 — throttle command */
  throttle: number;
  /** -1..1 — yaw rate command (positive = nose right) */
  yaw: number;
  /** -1..1 — pitch command (positive = nose up) */
  pitch: number;
  /** -1..1 — roll command (positive = roll right) */
  roll: number;
  /** Edge-triggered: true on the frame the user toggles flight mode */
  modeToggle: boolean;
  /** Edge-triggered: true on the frame the user requests a respawn */
  reset: boolean;
}

/** A snapshot of the drone's physics state, consumed by render + audio. */
export interface DroneState {
  position: Vec3;
  quaternion: Quat;
  linearVelocity: Vec3;
  angularVelocity: Vec3;
  /** Current commanded throttle, 0..1 */
  throttle: number;
  /** Motor RPM proxy 0..1 — drives prop spin and audio pitch */
  rpm: number;
}

/** Force (N) and torque (N·m) in the drone's local body frame. */
export interface BodyForces {
  force: Vec3;
  torque: Vec3;
}

/**
 * Translates pilot input into body-frame force + torque commands.
 * Implementations live in `src/flight/modes.ts`.
 */
export interface FlightController {
  readonly mode: FlightMode;
  setMode(mode: FlightMode): void;
  compute(input: InputState, state: DroneState, dt: number): BodyForces;
}

/**
 * Physics world abstraction so other streams don't depend on Rapier directly.
 * Implementation lives in `src/physics/world.ts`.
 */
export interface PhysicsWorld {
  /** Resolves once Rapier WASM is ready. Must be called before step(). */
  init(): Promise<void>;
  /** Advance simulation by dt seconds (use a fixed step). */
  step(dt: number): void;
  /** Snapshot the drone's current state. */
  getDroneState(): DroneState;
  /** Apply force expressed in the drone's body frame. */
  applyBodyForce(force: Vec3): void;
  /** Apply torque expressed in the drone's body frame. */
  applyBodyTorque(torque: Vec3): void;
  /** Re-pose the drone and zero its velocities. */
  resetDrone(position: Vec3): void;
}

/** Provides per-frame InputState. Implementation in `src/input/index.ts`. */
export interface InputProvider {
  /** Sample current input. Edge-triggered flags are auto-cleared after read. */
  sample(): InputState;
  /** Wire up DOM listeners. Idempotent. */
  attach(): void;
  /** Tear down DOM listeners. */
  detach(): void;
}

/**
 * Top-level event bus payloads. Add new event keys here so every stream
 * sees them in one place.
 */
export interface EventMap {
  gateCleared: { gateIndex: number; lapTimeMs: number };
  lapComplete: { lapTimeMs: number; lapNumber: number };
  modeChanged: { mode: FlightMode };
  reset: void;
  paused: void;
  resumed: void;
  /** Render reads this to drive prop spin / motor sound */
  rpmUpdated: { rpm: number };
}

export type EventName = keyof EventMap;
