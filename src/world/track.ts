/**
 * STREAM F — Race track + gates
 *
 * Builds 10 gate meshes arranged in a flowing race line, owns the lap state
 * machine, and emits 'gateCleared' / 'lapComplete' via the event bus.
 *
 * INTEGRATION NOTE for scene.ts:
 *   import { createTrack } from './world/track.ts';
 *   const track = createTrack();
 *   scene.add(track.group);
 *   // In the render/update loop, call each frame:
 *   track.update(droneState.position);
 *   // Wire reset event (createTrack does this internally, but you can also call):
 *   // track.reset();
 *
 * PHYSICS NOTE: Gate meshes are VISUAL ONLY. The physics collider in Stream B
 * only includes the ground plane. Gates and obstacles are non-collidable in the
 * MVP — the drone will phantom through them. Collision volumes can be added in a
 * follow-up sprint once the integration is stable.
 */

import * as THREE from 'three';
import type { Vec3 } from '../shared/types.ts';
import { on, emit } from '../shared/eventBus.ts';

// ---------------------------------------------------------------------------
// Gate appearance constants
// ---------------------------------------------------------------------------

/** Gate torus outer radius (m). Drone must pass within this to trigger. */
const GATE_RADIUS = 1.5;
/** Gate torus tube thickness (m). */
const GATE_TUBE = 0.1;
/** Radial segments (smoothness of the torus ring). */
const GATE_RADIAL_SEGS = 24;
/** Tubular segments (smoothness along the tube). */
const GATE_TUBULAR_SEGS = 8;

/** Drone must be within this horizontal distance of the gate centre. */
const CLEAR_XY_RADIUS = 1.4; // slightly inside the gate opening
/**
 * Gate "thickness" threshold along its local Z axis (the normal through the
 * gate's open face). The drone triggers when its signed projection onto the
 * gate normal crosses zero while also within CLEAR_XY_RADIUS.
 * We latch within ±GATE_THICKNESS_M of the plane.
 */
const GATE_THICKNESS_M = 0.35;

// ---------------------------------------------------------------------------
// Gate color palette
// ---------------------------------------------------------------------------

const COLOR_NEXT: THREE.ColorRepresentation = 0x00ffff;     // cyan — bright "aim here"
const COLOR_CLEARED: THREE.ColorRepresentation = 0x224444;  // dim teal — already done
const COLOR_FUTURE: THREE.ColorRepresentation = 0xffa500;   // orange — not yet

const EMISSIVE_NEXT = 1.2;
const EMISSIVE_CLEARED = 0.15;
const EMISSIVE_FUTURE = 0.5;

// ---------------------------------------------------------------------------
// Gate layout
// ---------------------------------------------------------------------------

/**
 * Hardcoded gate descriptors.
 * `position`: world-space centre of the gate opening [x, y, z].
 * `rotationY`: y-axis rotation in radians — the gate's local +Z (normal) points
 *              in direction (sin(rotationY), 0, cos(rotationY)).
 *
 * Course is ~85 m end-to-end, with gentle banks and altitude variation y=1..6.
 * All gates are described from a top-down perspective: the race line spirals
 * loosely around the origin in an oval/figure-eight shape.
 */
const GATE_DEFS: Array<{ position: Vec3; rotationY: number }> = [
  // Gate  0 — start/finish, heading south
  { position: [0, 2, -10],      rotationY: 0 },
  // Gate  1 — sweeping right turn, low
  { position: [15, 1.5, -25],   rotationY: Math.PI * 0.15 },
  // Gate  2 — heading east, rising
  { position: [30, 3, -20],     rotationY: Math.PI * 0.45 },
  // Gate  3 — top-right corner, high
  { position: [38, 5, -5],      rotationY: Math.PI * 0.5 },
  // Gate  4 — heading west at altitude
  { position: [30, 6, 10],      rotationY: Math.PI * 0.55 },
  // Gate  5 — descending back towards centre
  { position: [15, 4, 20],      rotationY: Math.PI * 0.85 },
  // Gate  6 — crossing centre heading west, low
  { position: [-5, 1.5, 15],    rotationY: Math.PI },
  // Gate  7 — top-left corner, rising
  { position: [-30, 4, 5],      rotationY: Math.PI * 1.45 },
  // Gate  8 — heading south again, high
  { position: [-28, 5.5, -15],  rotationY: Math.PI * 1.7 },
  // Gate  9 — final bend back to start, low
  { position: [-12, 2, -30],    rotationY: Math.PI * 1.9 },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackHandle {
  /** Add this THREE.Group to the Three.js scene. */
  group: THREE.Group;
  /**
   * Call every render/update frame with the drone's world-space position.
   * Manages lap state and emits events as the drone clears gates.
   */
  update(dronePosition: Vec3): void;
  /**
   * Restart lap state. Called internally on the 'reset' event, but the
   * integration agent can also call this directly (e.g. after resetDrone()).
   */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a MeshStandardMaterial for a gate with given base colour. */
function gateMaterial(color: THREE.ColorRepresentation, emissiveIntensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity,
    roughness: 0.4,
    metalness: 0.7,
  });
}

/** Apply NEXT / CLEARED / FUTURE colours to all gate meshes based on currentGateIndex. */
function recolorGates(meshes: THREE.Mesh[], currentGateIndex: number): void {
  for (let i = 0; i < meshes.length; i++) {
    const mat = meshes[i].material as THREE.MeshStandardMaterial;
    if (i === currentGateIndex) {
      mat.color.set(COLOR_NEXT);
      mat.emissive.set(COLOR_NEXT);
      mat.emissiveIntensity = EMISSIVE_NEXT;
    } else if (i < currentGateIndex) {
      mat.color.set(COLOR_CLEARED);
      mat.emissive.set(COLOR_CLEARED);
      mat.emissiveIntensity = EMISSIVE_CLEARED;
    } else {
      mat.color.set(COLOR_FUTURE);
      mat.emissive.set(COLOR_FUTURE);
      mat.emissiveIntensity = EMISSIVE_FUTURE;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTrack(): TrackHandle {
  const group = new THREE.Group();
  group.name = 'track';

  // Build gate geometry (shared — all gates are identical toruses)
  const gateGeo = new THREE.TorusGeometry(GATE_RADIUS, GATE_TUBE, GATE_RADIAL_SEGS, GATE_TUBULAR_SEGS);

  const gateMeshes: THREE.Mesh[] = [];
  // Pre-cache gate world normals (pointing through the gate opening) to avoid
  // per-frame matrix decompositions. Each gate's normal in world space is
  // (sin(rotationY), 0, cos(rotationY)) — the local +Z after a Y rotation.
  const gateNormals: THREE.Vector3[] = [];
  const gateCentres: THREE.Vector3[] = [];

  for (let i = 0; i < GATE_DEFS.length; i++) {
    const def = GATE_DEFS[i];

    const isNext = i === 0;
    const color = isNext ? COLOR_NEXT : COLOR_FUTURE;
    const intensity = isNext ? EMISSIVE_NEXT : EMISSIVE_FUTURE;
    const mesh = new THREE.Mesh(gateGeo, gateMaterial(color, intensity));
    mesh.name = `gate_${i}`;
    mesh.position.set(...def.position);
    // Torus lies in the XY plane by default (opening along +Z).
    // We rotate around Y to point the gate along the race line.
    mesh.rotation.y = def.rotationY;

    group.add(mesh);
    gateMeshes.push(mesh);

    gateCentres.push(new THREE.Vector3(...def.position));
    gateNormals.push(new THREE.Vector3(
      Math.sin(def.rotationY),
      0,
      Math.cos(def.rotationY),
    ).normalize());
  }

  // ---------------------------------------------------------------------------
  // Lap state
  // ---------------------------------------------------------------------------

  let currentGateIndex = 0;
  let lapStart: number | null = null;
  let lapNumber = 0;
  // Track whether the drone was "behind" the current gate's plane last frame so
  // we only fire on the crossing event rather than every frame near a gate.
  let lastSignedDist: number | null = null;

  function reset(): void {
    currentGateIndex = 0;
    lapStart = null;
    // lapNumber deliberately NOT reset — it counts total laps across all resets.
    lastSignedDist = null;
    recolorGates(gateMeshes, currentGateIndex);
  }

  // Subscribe internally to the event bus 'reset' signal.
  on('reset', () => reset());

  // ---------------------------------------------------------------------------
  // Gate detection algorithm
  //
  // For each frame we check the CURRENT target gate only (index = currentGateIndex).
  // Two conditions must both be true to count a clearance:
  //
  //   1. Radial distance: the drone is within CLEAR_XY_RADIUS (1.4 m) of the
  //      gate centre when projected onto the gate's local XY plane (i.e., the
  //      plane perpendicular to the gate normal). In practice we compute the 3D
  //      distance from drone to gate centre, then subtract the component along
  //      the gate normal — this gives the lateral offset.
  //
  //   2. Plane crossing: the signed dot-product of (drone - gateCenter) onto
  //      the gate normal is within ±GATE_THICKNESS_M. This detects the moment
  //      the drone crosses the gate plane rather than firing on every frame the
  //      drone is nearby. We also check for a sign change between frames to
  //      ensure we fire exactly once per pass.
  //
  // This is a lightweight approximation; it handles typical FPV flight angles
  // well. It may misfire if the drone approaches at extreme angles, but that is
  // acceptable for MVP.
  // ---------------------------------------------------------------------------

  const _tmpDrone = new THREE.Vector3();
  const _tmpDiff = new THREE.Vector3();

  function update(dronePosition: Vec3): void {
    const gate = gateMeshes[currentGateIndex];
    const centre = gateCentres[currentGateIndex];
    const normal = gateNormals[currentGateIndex];

    _tmpDrone.set(...dronePosition);
    _tmpDiff.subVectors(_tmpDrone, centre);

    // Signed distance along the gate normal (positive = in front, negative = behind)
    const signedDist = _tmpDiff.dot(normal);

    // Lateral distance in the gate plane
    // lateralVec = diff - signedDist * normal
    const lateralDist = Math.sqrt(
      Math.max(0, _tmpDiff.lengthSq() - signedDist * signedDist),
    );

    const withinRadius = lateralDist < CLEAR_XY_RADIUS;
    const withinThickness = Math.abs(signedDist) < GATE_THICKNESS_M;

    // Detect crossing: sign flipped from last frame.
    // We require a real crossing — never fire on the first frame after a gate
    // advance (that would let the next gate insta-trigger if the drone is
    // already within its threshold zone).
    const justCrossed = lastSignedDist !== null
      && ((lastSignedDist < 0 && signedDist >= 0) || (lastSignedDist >= 0 && signedDist < 0));

    if (withinRadius && withinThickness && justCrossed) {
      // Start the lap timer ON gate 0 — its lapTimeMs is meaningless (≈0) and
      // we suppress emitting it. Subsequent gates report split times relative
      // to gate 0.
      const isFirstGate = currentGateIndex === 0;
      if (isFirstGate) {
        lapStart = performance.now();
      }

      const lapTimeMs = lapStart !== null ? performance.now() - lapStart : 0;

      emit('gateCleared', { gateIndex: currentGateIndex, lapTimeMs });

      currentGateIndex++;

      if (currentGateIndex >= GATE_DEFS.length) {
        // Lap complete — increment first so the emitted lapNumber is 1-indexed.
        lapNumber++;
        emit('lapComplete', { lapTimeMs, lapNumber });
        currentGateIndex = 0;
        // Start new lap timer immediately from now (continuous racing)
        lapStart = performance.now();
      }

      recolorGates(gateMeshes, currentGateIndex);

      // Seed lastSignedDist with the new gate's signed distance so the next
      // crossing detection has a valid baseline (rather than null, which would
      // disable crossing detection until the *next* frame).
      const newCentre = gateCentres[currentGateIndex];
      const newNormal = gateNormals[currentGateIndex];
      _tmpDiff.subVectors(_tmpDrone, newCentre);
      lastSignedDist = _tmpDiff.dot(newNormal);
      return;
    }

    lastSignedDist = signedDist;

    // Subtle pulse animation on the next gate to draw attention
    if (withinRadius) {
      const mat = gate.material as THREE.MeshStandardMaterial;
      const pulse = 1.0 + 0.4 * Math.sin(performance.now() * 0.004);
      mat.emissiveIntensity = EMISSIVE_NEXT * pulse;
    }
  }

  return { group, update, reset };
}
