/**
 * Bootstrap — wires every stream's module into a fixed-step game loop.
 *
 * Stream A ships this with stubs only: it proves all modules import cleanly,
 * the canvas mounts full-bleed, and the loop runs without errors. Subsequent
 * streams replace their stubbed modules without touching this file.
 */
import './style.css';
import { createRenderer } from './render/scene.ts';
import { input } from './input/index.ts';
import { physicsWorld } from './physics/world.ts';
import { flightController } from './flight/modes.ts';
import { MAX_PHYSICS_STEPS_PER_FRAME, PHYSICS_DT, SPAWN_POSITION } from './shared/constants.ts';
import { emit, on } from './shared/eventBus.ts';
import type { Vec3 } from './shared/types.ts';

const canvas = document.getElementById('viewport') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#viewport canvas missing from index.html');

const splash = document.getElementById('splash');
const splashStatus = document.getElementById('splash-status');
const setStatus = (msg: string): void => {
  if (splashStatus) splashStatus.textContent = msg;
  console.info('[boot]', msg);
};

async function boot(): Promise<void> {
  setStatus('Initializing renderer...');
  const render = createRenderer(canvas!);

  setStatus('Initializing physics (Rapier WASM)...');
  await physicsWorld.init();

  setStatus('Attaching input...');
  input.attach();

  on('modeChanged', ({ mode }) => console.info('[event] mode ->', mode));
  on('reset', () => physicsWorld.resetDrone([...SPAWN_POSITION] as Vec3));

  window.addEventListener('resize', () => render.resize(window.innerWidth, window.innerHeight));

  let last = performance.now();
  let accumulator = 0;

  function frame(now: number): void {
    const dtSec = Math.min((now - last) / 1000, 0.25);
    last = now;
    accumulator += dtSec;

    let steps = 0;
    while (accumulator >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS_PER_FRAME) {
      const cmd = input.sample();
      if (cmd.modeToggle) {
        flightController.setMode(flightController.mode === 'arcade' ? 'acro' : 'arcade');
      }
      if (cmd.reset) emit('reset', undefined);

      const state = physicsWorld.getDroneState();
      const { force, torque } = flightController.compute(cmd, state, PHYSICS_DT);
      physicsWorld.applyBodyForce(force);
      physicsWorld.applyBodyTorque(torque);
      physicsWorld.step(PHYSICS_DT);

      accumulator -= PHYSICS_DT;
      steps += 1;
    }

    const state = physicsWorld.getDroneState();
    render.update(state);
    render.render();
    requestAnimationFrame(frame);
  }

  setStatus('Ready. Streams B–H pending.');
  splash?.classList.add('hidden');
  requestAnimationFrame(frame);
}

boot().catch((err: unknown) => {
  console.error(err);
  setStatus(`Boot failed: ${(err as Error).message}`);
});
