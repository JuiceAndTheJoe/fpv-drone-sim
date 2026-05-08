/**
 * STREAM E — Scene + FPV camera
 * Owner: TBD
 *
 * Owns the Three.js renderer, camera (parented to drone), lights, skybox.
 * Chase-cam toggled by pressing V — camera detaches from drone group and
 * follows from behind with EMA smoothing.
 */
import * as THREE from 'three';
import type { DroneState } from '../shared/types.ts';
import { on } from '../shared/eventBus.ts';
import { createDronePlaceholder } from './drone.ts';
import { createHud } from './hud.ts';

export interface RenderHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Update camera + drone transform from the latest physics snapshot. */
  update(state: DroneState): void;
  /** Draw one frame. */
  render(): void;
  /** Handle viewport resize. */
  resize(width: number, height: number): void;
  /** Free GL resources. */
  dispose(): void;
}

// ── Chase-cam smoothing constants ────────────────────────────────────────────

/** How far behind and above the drone the chase camera floats (local offsets). */
const CHASE_OFFSET = new THREE.Vector3(0, 0.6, 2.2);
/** EMA alpha for chase camera position (lower = more lag / smoother). */
const CHASE_POS_ALPHA = 0.08;
/** EMA alpha for chase camera look-at target. */
const CHASE_LOOK_ALPHA = 0.12;

// ── FPV camera offset from drone origin ─────────────────────────────────────

/** Slight upward offset so props peek into bottom of FOV. */
const FPV_OFFSET = new THREE.Vector3(0, 0.025, 0);

export function createRenderer(canvas: HTMLCanvasElement): RenderHandle {
  // ── Renderer ───────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const isMobile = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Shadow maps disabled for perf (Stream E spec)

  // ── Scene + background ─────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  // Light haze to convey depth
  scene.fog = new THREE.Fog(0x87ceeb, 80, 400);

  // ── Lights ─────────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x4a3a2a, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.0);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  // ── Camera ─────────────────────────────────────────────────────────────────
  // Vertical FOV — at 16:9 this is ~115° horizontal, in FPV-goggle territory.
  const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.05, 2000);

  // ── Drone group ────────────────────────────────────────────────────────────
  const { group: droneGroup, setRpm } = createDronePlaceholder();
  scene.add(droneGroup);

  // Start with camera in FPV mode (parented to drone group)
  camera.position.copy(FPV_OFFSET);
  camera.rotation.set(0, 0, 0);
  droneGroup.add(camera);

  // (Ground + skybox come from Stream F's createWorld(), added in main.ts.)

  // ── HUD ────────────────────────────────────────────────────────────────────
  const hud = createHud();

  // ── State ──────────────────────────────────────────────────────────────────
  let chaseMode = false;

  // Chase camera smooth tracking targets
  const chasePos = new THREE.Vector3(0, 2, 4);
  const chaseLookAt = new THREE.Vector3(0, 1.5, 0);

  // FPS EMA
  let lastFrameTime = performance.now();
  let smoothFps = 60;
  const FPS_ALPHA = 0.1;

  // ── Event subscriptions ────────────────────────────────────────────────────
  const unsubMode = on('modeChanged', ({ mode }) => {
    hud.setMode(mode);
  });

  // V key toggles chase / FPV
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'v' || e.key === 'V') {
      toggleChaseMode();
    }
  }
  window.addEventListener('keydown', onKeyDown);

  function toggleChaseMode(): void {
    if (!chaseMode) {
      // Entering chase mode: remove camera from drone group, add to scene
      droneGroup.remove(camera);
      scene.add(camera);

      // Seed chase position to current world position to avoid a jump
      const worldPos = new THREE.Vector3();
      droneGroup.getWorldPosition(worldPos);
      chasePos.copy(worldPos).add(CHASE_OFFSET);
      chaseLookAt.copy(worldPos);
      camera.position.copy(chasePos);
      camera.lookAt(chaseLookAt);

      chaseMode = true;
    } else {
      // Re-entering FPV: remove from scene, re-parent to drone
      scene.remove(camera);
      camera.position.copy(FPV_OFFSET);
      camera.rotation.set(0, 0, 0);
      droneGroup.add(camera);
      chaseMode = false;
    }
  }

  // ── Helper: velocity magnitude from state ─────────────────────────────────
  function speedMs(state: DroneState): number {
    const [vx, vy, vz] = state.linearVelocity;
    return Math.sqrt(vx * vx + vy * vy + vz * vz);
  }

  // ── update ─────────────────────────────────────────────────────────────────
  function update(state: DroneState): void {
    // Apply drone transform
    droneGroup.position.set(...state.position);
    droneGroup.quaternion.set(...state.quaternion);

    // Drive props
    setRpm(state.rpm);

    // Chase camera smooth follow
    if (chaseMode) {
      const droneWorld = new THREE.Vector3(...state.position);
      const droneQuat = new THREE.Quaternion(...state.quaternion);

      // Desired camera world position: offset behind/above the drone in world space
      const desiredOffset = CHASE_OFFSET.clone().applyQuaternion(droneQuat);
      const desiredPos = droneWorld.clone().add(desiredOffset);

      // EMA smooth
      chasePos.lerp(desiredPos, CHASE_POS_ALPHA);
      chaseLookAt.lerp(droneWorld, CHASE_LOOK_ALPHA);

      camera.position.copy(chasePos);
      camera.lookAt(chaseLookAt);
    }

    // HUD — compute speed from linear velocity
    hud.update({
      throttle: state.throttle,
      fps: smoothFps,
      position: state.position,
      speedMs: speedMs(state),
    });
  }

  // ── render ─────────────────────────────────────────────────────────────────
  function render(): void {
    const now = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    // EMA for FPS
    const instantFps = dt > 0 ? 1000 / dt : 60;
    smoothFps = smoothFps + FPS_ALPHA * (instantFps - smoothFps);

    renderer.render(scene, camera);
  }

  // ── resize ─────────────────────────────────────────────────────────────────
  function resize(width: number, height: number): void {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  // ── dispose ────────────────────────────────────────────────────────────────
  function dispose(): void {
    unsubMode();
    window.removeEventListener('keydown', onKeyDown);
    hud.dispose();
    renderer.dispose();
  }

  return {
    renderer,
    scene,
    camera,
    update,
    render,
    resize,
    dispose,
  };
}
