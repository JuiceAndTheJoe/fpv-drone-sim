/**
 * Bootstrap — wires every stream's module into a fixed-step game loop.
 *
 * Stream A originally shipped this with stubs only. After Streams B–H landed,
 * the integration sprint added: track + world (F), pause-aware loop gate (G),
 * and motor-audio RPM piping (H). Each stream still owns its files; this file
 * is the only place that knows how the pieces connect.
 */
import './style.css';
import { createRenderer } from './render/scene.ts';
import { input } from './input/index.ts';
import { physicsWorld } from './physics/world.ts';
import { flightController } from './flight/modes.ts';
import { createTrack } from './world/track.ts';
import { createWorld } from './world/props.ts';
import { createMenu } from './ui/menu.ts';
import { createOnboarding } from './ui/onboarding.ts';
import { createMobileHelpers } from './ui/mobile.ts';
import { createMotorAudio } from './audio/motor.ts';
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

  setStatus('Building world...');
  const world = createWorld(render.scene);
  render.scene.add(world.group);
  const track = createTrack();
  render.scene.add(track.group);

  setStatus('Initializing physics (Rapier WASM)...');
  await physicsWorld.init();

  setStatus('Attaching input + UI...');
  input.attach();
  const motor = createMotorAudio();
  motor.attach();
  const menu = createMenu();
  menu.attach();
  const onboarding = createOnboarding();
  onboarding.attach();
  const mobile = createMobileHelpers();
  mobile.attach();

  on('modeChanged', ({ mode }) => flightController.setMode(mode));
  on('reset', () => {
    physicsWorld.resetDrone([...SPAWN_POSITION] as Vec3);
    track.reset();
  });

  // Pause-aware loop: when 'paused' (menu open) we stop stepping physics.
  let paused = false;
  on('paused', () => { paused = true; });
  on('resumed', () => {
    paused = false;
    last = performance.now();
    accumulator = 0;
  });

  window.addEventListener('resize', () => render.resize(window.innerWidth, window.innerHeight));

  let last = performance.now();
  let accumulator = 0;

  function frame(now: number): void {
    const dtSec = Math.min((now - last) / 1000, 0.25);
    last = now;

    if (!paused) {
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
    }

    const state = physicsWorld.getDroneState();
    track.update(state.position);
    render.update(state);
    render.render();
    emit('rpmUpdated', { rpm: state.rpm });
    requestAnimationFrame(frame);
  }

  setStatus('Ready.');
  splash?.classList.add('hidden');
  requestAnimationFrame(frame);
}

boot().catch((err: unknown) => {
  console.error(err);
  setStatus(`Boot failed: ${(err as Error).message}`);
});
