/**
 * STREAM C — Flight controllers
 * Owner: TBD
 *
 * Maps InputState -> body-frame force + torque for both flight modes.
 *  - acro:   stick = target body rate, P-controlled to torque
 *  - arcade: stick = target attitude, cascaded controller (attitude->rate->torque)
 *
 * Both modes share the same throttle->thrust mapping.
 */
import type {
  BodyForces,
  DroneState,
  FlightController,
  FlightMode,
  InputState,
} from '../shared/types.ts';
import { emit } from '../shared/eventBus.ts';

const ZERO_FORCES: BodyForces = { force: [0, 0, 0], torque: [0, 0, 0] };

class StubController implements FlightController {
  mode: FlightMode = 'arcade';

  setMode(mode: FlightMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    emit('modeChanged', { mode });
  }

  compute(_input: InputState, _state: DroneState, _dt: number): BodyForces {
    return {
      force: [...ZERO_FORCES.force] as [number, number, number],
      torque: [...ZERO_FORCES.torque] as [number, number, number],
    };
  }
}

export const flightController: FlightController = new StubController();
