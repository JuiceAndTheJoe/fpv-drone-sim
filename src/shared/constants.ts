/**
 * Physical and simulation constants.
 * Streams read from here so tuning happens in one place.
 */

/** Fixed-step physics frequency (Hz). 120 Hz keeps acro feeling crisp. */
export const PHYSICS_HZ = 120;

/** Fixed timestep in seconds derived from PHYSICS_HZ. */
export const PHYSICS_DT = 1 / PHYSICS_HZ;

/** Cap on physics catch-up steps per render frame to avoid spiral-of-death. */
export const MAX_PHYSICS_STEPS_PER_FRAME = 8;

/** Gravitational acceleration (m/s^2), -Y in world space. */
export const GRAVITY = 9.81;

/** Drone mass (kg). 5" race quad ~500 g. */
export const MASS_KG = 0.5;

/** Drone bounding box half-extents (m) for the physics collider. */
export const DRONE_HALF_EXTENTS: [number, number, number] = [0.06, 0.02, 0.06];

/** Linear drag coefficient (Ns/m). */
export const LINEAR_DRAG = 0.1;

/** Quadratic drag coefficient (Ns^2/m^2). */
export const QUADRATIC_DRAG = 0.05;

/** Angular drag coefficient (N·m·s/rad). */
export const ANGULAR_DRAG = 0.5;

/** World floor Y. */
export const GROUND_Y = 0;

/** Y below which the drone auto-resets. */
export const FALL_RESET_Y = -50;

/** Default spawn pose. */
export const SPAWN_POSITION: [number, number, number] = [0, 1.5, 0];
