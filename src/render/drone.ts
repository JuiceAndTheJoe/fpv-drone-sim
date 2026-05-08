/**
 * STREAM E — Drone mesh + prop spin
 *
 * Builds a procedural placeholder quad: body box + 4 spinning prop discs +
 * two LED accents (red front, green back). No external assets required.
 *
 * setRpm(rpm, dt?) is called once per frame from scene.ts's update().
 * dt is optional — if omitted, the method measures its own delta via
 * performance.now() so callers don't need to thread it through.
 */
import * as THREE from 'three';
import { DRONE_HALF_EXTENTS } from '../shared/constants.ts';

/** Full body dimensions derived from physics collider half-extents. */
const BODY_W = DRONE_HALF_EXTENTS[0] * 2; // 0.12 m
const BODY_H = DRONE_HALF_EXTENTS[1] * 2; // 0.04 m
const BODY_D = DRONE_HALF_EXTENTS[2] * 2; // 0.12 m

const PROP_RADIUS = 0.03;   // 3 cm disc radius
const PROP_THICKNESS = 0.004; // thin disc
const LED_RADIUS = 0.008;
const LED_HEIGHT = 0.006;

/** Arm length from body centre to prop centre (sits near each corner). */
const ARM = DRONE_HALF_EXTENTS[0] * 0.85; // ~0.051 m

export interface DroneHandle {
  group: THREE.Group;
  /** Drive prop spin. rpm is a 0..1 normalised value (see DroneState.rpm). */
  setRpm(rpm: number): void;
}

export function createDronePlaceholder(): DroneHandle {
  const group = new THREE.Group();

  // ── Body ──────────────────────────────────────────────────────────────────
  const bodyGeo = new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1f,
    roughness: 0.6,
    metalness: 0.4,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // ── Props (4 corners) ──────────────────────────────────────────────────────
  const propGeo = new THREE.CylinderGeometry(PROP_RADIUS, PROP_RADIUS, PROP_THICKNESS, 16);
  const propMat = new THREE.MeshStandardMaterial({
    color: 0x222233,
    roughness: 0.4,
    metalness: 0.7,
    transparent: true,
    opacity: 0.85,
  });

  // Prop positions: FR, FL, RR, RL (front/rear, left/right in local coords)
  // +X = right, +Z = backward, +Y = up  (Three.js default world orientation)
  const propOffsets: [number, number, number][] = [
    [ ARM, BODY_H * 0.5, -ARM], // front-right
    [-ARM, BODY_H * 0.5, -ARM], // front-left
    [ ARM, BODY_H * 0.5,  ARM], // rear-right
    [-ARM, BODY_H * 0.5,  ARM], // rear-left
  ];

  const propMeshes: THREE.Mesh[] = propOffsets.map(([x, y, z]) => {
    const mesh = new THREE.Mesh(propGeo, propMat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  });

  // ── LED accents ───────────────────────────────────────────────────────────
  const ledGeo = new THREE.CylinderGeometry(LED_RADIUS, LED_RADIUS, LED_HEIGHT, 8);

  // Red at front (−Z in local space)
  const redMat = new THREE.MeshStandardMaterial({
    color: 0xff2020,
    emissive: 0xff0000,
    emissiveIntensity: 1.2,
    roughness: 0.3,
    metalness: 0.0,
  });
  const redLed = new THREE.Mesh(ledGeo, redMat);
  redLed.position.set(0, BODY_H * 0.5, -(BODY_D * 0.5 - LED_RADIUS));
  group.add(redLed);

  // Green at back (+Z in local space)
  const greenMat = new THREE.MeshStandardMaterial({
    color: 0x20ff60,
    emissive: 0x00ff40,
    emissiveIntensity: 1.2,
    roughness: 0.3,
    metalness: 0.0,
  });
  const greenLed = new THREE.Mesh(ledGeo, greenMat);
  greenLed.position.set(0, BODY_H * 0.5, BODY_D * 0.5 - LED_RADIUS);
  group.add(greenLed);

  // ── Prop spin state ────────────────────────────────────────────────────────
  let lastTime = performance.now();

  /**
   * MAX_PROP_RPS: at rpm=1 (full throttle), props spin at ~200 rev/s on a
   * real 5" quad. We use a visual-feel value of 60 rps (enough to look fast).
   */
  const MAX_PROP_RPS = 60;

  function setRpm(rpm: number): void {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    const dAngle = rpm * MAX_PROP_RPS * Math.PI * 2 * dt;
    // Alternate CW/CCW per motor (standard X-frame pattern)
    const signs = [1, -1, -1, 1];
    for (let i = 0; i < propMeshes.length; i++) {
      propMeshes[i].rotation.y += signs[i] * dAngle;
    }
  }

  return { group, setRpm };
}
