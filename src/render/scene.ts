/**
 * STREAM E — Scene + FPV camera
 * Owner: TBD
 *
 * Owns the Three.js renderer, camera (parented to drone), lights, skybox.
 */
import * as THREE from 'three';
import type { DroneState } from '../shared/types.ts';

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

export function createRenderer(canvas: HTMLCanvasElement): RenderHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const isMobile = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(110, window.innerWidth / window.innerHeight, 0.05, 2000);
  camera.position.set(0, 1.5, 4);
  camera.lookAt(0, 1.5, 0);

  const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x4a3a2a, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.0);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  return {
    renderer,
    scene,
    camera,
    update(_state: DroneState): void {
      // TODO(stream-e): position FPV camera at drone offset, apply quaternion
    },
    render(): void {
      renderer.render(scene, camera);
    },
    resize(width: number, height: number): void {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose(): void {
      renderer.dispose();
    },
  };
}
