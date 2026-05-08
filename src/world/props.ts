/**
 * STREAM F — Environment props
 *
 * Procedural skybox, textured ground, and freestyle obstacles.
 * Uses InstancedMesh for repeated cone props.
 *
 * INTEGRATION NOTE for scene.ts:
 *   import { createWorld } from './world/props.ts';
 *   const world = createWorld(scene);  // pass the THREE.Scene for background/fog
 *   scene.add(world.group);
 *
 * SKYBOX APPROACH:
 *   A large inside-out sphere (SphereGeometry radius=900, BackSide) with a
 *   ShaderMaterial that blends from warm horizon (0xffe0b0) to deep sky blue
 *   (0x1a3a6e) at the zenith. A THREE.FogExp2 with a soft blue-grey colour adds
 *   atmospheric depth and hides the hard edge of the ground plane at distance.
 *   This avoids any external texture assets while still looking pleasant.
 *
 * PHYSICS NOTE: All meshes in this module are VISUAL ONLY. The ground plane
 * physics collider lives in Stream B (physics/world.ts) and is not duplicated
 * here. Gates and obstacles are non-collidable in the MVP.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUND_SIZE = 500;
const GRID_CELLS = 500;     // canvas grid lines per axis (1 m cells)
const FOG_COLOR = 0x8aaabf;
const FOG_DENSITY = 0.004;

// Obstacle placement seed — deterministic pseudo-random layout
const OBSTACLE_SEED = 42;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WorldHandle {
  /** Add this THREE.Group to the Three.js scene. */
  group: THREE.Group;
}

// ---------------------------------------------------------------------------
// Simple seeded PRNG (Mulberry32) so placement is deterministic
// ---------------------------------------------------------------------------

function makePRNG(seed: number): () => number {
  let s = seed;
  return function (): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Skybox
// ---------------------------------------------------------------------------

function buildSkybox(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 32, 16);

  // Vertex-colour gradient: horizon warm → zenith deep blue.
  // Three.js SphereGeometry has vertices ordered from top (+Y) to bottom (−Y).
  const colors: number[] = [];
  const posAttr = geo.attributes['position'] as THREE.BufferAttribute;
  const horizon = new THREE.Color(0xffd090);  // warm orange-white
  const zenith = new THREE.Color(0x1a3a6e);   // deep sky blue
  const nadir = new THREE.Color(0x6e4a1a);    // warm earth tone for the lower dome

  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const t = y / 900; // −1..+1 normalised

    const c = new THREE.Color();
    if (t >= 0) {
      // Upper hemisphere: horizon → zenith
      c.lerpColors(horizon, zenith, Math.sqrt(t));
    } else {
      // Lower hemisphere: horizon → nadir (seen when camera tilts down)
      c.lerpColors(horizon, nadir, Math.sqrt(-t));
    }
    colors.push(c.r, c.g, c.b);
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false, // skybox must not be affected by scene fog
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'skybox';
  return mesh;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

/**
 * Creates a CanvasTexture with a 1-m grid drawn over an earth-tone base.
 * wrapS/wrapT + repeat tile it across the full 500 m plane.
 */
function buildGroundTexture(): THREE.CanvasTexture {
  const SIZE = 512; // pixels per tile
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  // Earth-tone base
  ctx.fillStyle = '#5c4a2a';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle noise-like variation (2 offset fills at low alpha)
  ctx.fillStyle = 'rgba(80,65,35,0.4)';
  ctx.fillRect(0, 0, SIZE / 2, SIZE / 2);
  ctx.fillRect(SIZE / 2, SIZE / 2, SIZE / 2, SIZE / 2);

  // Grid lines
  ctx.strokeStyle = 'rgba(180,155,90,0.35)';
  ctx.lineWidth = 1;
  // One grid line per tile = 1 m grid at repeat (500,500)
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(SIZE, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, SIZE);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(GRID_CELLS, GRID_CELLS);
  return tex;
}

function buildGround(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    map: buildGroundTexture(),
    roughness: 0.9,
    metalness: 0.0,
    color: 0x7a6038,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground';
  mesh.rotation.x = -Math.PI / 2; // lay flat
  mesh.position.y = 0;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Cones — InstancedMesh (≥10 instances)
// ---------------------------------------------------------------------------

function buildCones(rng: () => number, group: THREE.Group): void {
  const COUNT = 14;
  const geo = new THREE.ConeGeometry(0.25, 0.75, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff4400, roughness: 0.6 });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.name = 'cones';

  const dummy = new THREE.Object3D();
  for (let i = 0; i < COUNT; i++) {
    // Scatter cones within a 60 m radius, avoiding the origin spawn area (< 5 m)
    let x: number, z: number;
    do {
      x = (rng() - 0.5) * 120;
      z = (rng() - 0.5) * 120;
    } while (Math.sqrt(x * x + z * z) < 5);

    dummy.position.set(x, 0.375, z); // half-height above ground
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.scale.setScalar(0.8 + rng() * 0.6);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

// ---------------------------------------------------------------------------
// Ramps
// ---------------------------------------------------------------------------

function buildRamps(rng: () => number, group: THREE.Group): void {
  const RAMP_COUNT = 6;
  const geo = new THREE.BoxGeometry(4, 0.3, 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });

  for (let i = 0; i < RAMP_COUNT; i++) {
    let x: number, z: number;
    do {
      x = (rng() - 0.5) * 140;
      z = (rng() - 0.5) * 140;
    } while (Math.sqrt(x * x + z * z) < 8);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `ramp_${i}`;
    mesh.position.set(x, 0.35, z);
    // Tilt the ramp ~20° to make it an actual ramp (incline)
    mesh.rotation.x = -Math.PI / 9; // ~20° pitch
    mesh.rotation.y = rng() * Math.PI * 2;
    group.add(mesh);
  }
}

// ---------------------------------------------------------------------------
// Building shells (hollow box: 4 walls, no roof)
// ---------------------------------------------------------------------------

function buildBuildingShell(
  x: number, z: number,
  width: number, depth: number, height: number,
  group: THREE.Group,
  index: number,
): void {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a5568,
    roughness: 0.8,
    metalness: 0.1,
  });

  // Each wall: [halfX, halfY (height), halfZ, localX, localY, localZ].
  // Front/back walls span the full width and height with thin Z (depth=0.2).
  // Side walls span the full depth and height with thin X (width=0.2).
  const wallDefs: Array<[number, number, number, number, number, number]> = [
    [width / 2, height / 2, 0.1,  0,         height / 2,  depth / 2],   // front wall
    [width / 2, height / 2, 0.1,  0,         height / 2, -depth / 2],   // back wall
    [0.1, height / 2, depth / 2,  width / 2, height / 2,  0],            // right wall
    [0.1, height / 2, depth / 2, -width / 2, height / 2,  0],            // left wall
  ];

  const shell = new THREE.Group();
  shell.name = `building_${index}`;
  shell.position.set(x, 0, z);

  for (let i = 0; i < wallDefs.length; i++) {
    const [hx, hy, hz, lx, ly, lz] = wallDefs[i];
    const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const wall = new THREE.Mesh(geo, mat);
    wall.position.set(lx, ly, lz);
    wall.castShadow = true;
    shell.add(wall);
  }

  group.add(shell);
}

function buildBuildings(rng: () => number, group: THREE.Group): void {
  const BUILDING_COUNT = 2;

  for (let i = 0; i < BUILDING_COUNT; i++) {
    let x: number, z: number;
    do {
      x = (rng() - 0.5) * 120;
      z = (rng() - 0.5) * 120;
    } while (Math.sqrt(x * x + z * z) < 15);

    const width = 8 + rng() * 4;
    const depth = 8 + rng() * 4;
    const height = 6 + rng() * 4;
    buildBuildingShell(x, z, width, depth, height, group, i);
  }
}

// ---------------------------------------------------------------------------
// Additional scatter: flat marker discs (visual only) to break up ground
// ---------------------------------------------------------------------------

function buildMarkers(rng: () => number, group: THREE.Group): void {
  const COUNT = 12;
  const geo = new THREE.CylinderGeometry(1.2, 1.2, 0.05, 16);
  const colors = [0xffffff, 0xffff00, 0x00ff88];

  for (let i = 0; i < COUNT; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: colors[i % colors.length],
      roughness: 0.5,
      emissive: colors[i % colors.length],
      emissiveIntensity: 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `marker_${i}`;
    const x = (rng() - 0.5) * 160;
    const z = (rng() - 0.5) * 160;
    mesh.position.set(x, 0.025, z);
    group.add(mesh);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWorld(scene: THREE.Scene): WorldHandle {
  // Apply atmospheric fog to the scene
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

  // Lights — placed here so props.ts is self-contained; scene.ts can add more.
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  ambient.name = 'world_ambient';

  const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
  sun.name = 'world_sun';
  sun.position.set(60, 80, 40);
  sun.castShadow = false; // shadows off for MVP perf

  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x7a6038, 0.6);
  hemi.name = 'world_hemi';

  const group = new THREE.Group();
  group.name = 'world';

  group.add(ambient);
  group.add(sun);
  group.add(hemi);
  group.add(buildSkybox());
  group.add(buildGround());

  const rng = makePRNG(OBSTACLE_SEED);
  buildCones(rng, group);
  buildRamps(rng, group);
  buildBuildings(rng, group);
  buildMarkers(rng, group);

  return { group };
}
