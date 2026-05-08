/**
 * STREAM H — Motor audio (synthesized, no assets needed)
 *
 * createMotorAudio() returns { attach, detach, setRpm, setVolume }.
 *
 * Synthesis chain:
 *   FM modulator (sine) → detunes carrier sawtooth osc
 *   Carrier osc (sawtooth) → BiquadFilter (lowpass, Q=8) → GainNode (master)
 *
 * setRpm(0..1):
 *   carrier.frequency = 80 + rpm * 320  (Hz)
 *   filter.frequency  = 200 + rpm * 4000 (Hz)
 *   masterGain.gain   = rpm * 0.3 * volumeScale
 *
 * 'gateCleared' event → short 80 ms 1200 Hz triangle tick.
 * 'rpmUpdated'  event → setRpm(rpm) (render stream pipes RPM here).
 * 'userGesture' window event → resume AudioContext (iOS policy).
 */

import { on } from '../shared/eventBus.ts';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMotorAudio(): {
  attach(): void;
  detach(): void;
  setRpm(rpm: number): void;
  setVolume(v: number): void;
} {
  let ctx: AudioContext | null = null;
  let carrier: OscillatorNode | null = null;
  let modulator: OscillatorNode | null = null;
  let modGain: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let masterGain: GainNode | null = null;

  let currentRpm = 0;
  let volumeScale = 1.0; // 0..1, set by setVolume
  let running = false;

  // Unsubscribe handles
  let unsubGateCleared: (() => void) | null = null;
  let unsubRpmUpdated: (() => void) | null = null;

  // ---------------------------------------------------------------------------
  // AudioContext lifecycle
  // ---------------------------------------------------------------------------

  function ensureContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
    }
    return ctx;
  }

  function buildChain(): void {
    if (running) return;
    const ac = ensureContext();

    // Master gain (output)
    masterGain = ac.createGain();
    masterGain.gain.value = 0; // silent until setRpm is called
    masterGain.connect(ac.destination);

    // Low-pass filter (the "whine" character)
    filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 8;
    filter.frequency.value = 200;
    filter.connect(masterGain);

    // Carrier oscillator — sawtooth for gritty motor tone
    carrier = ac.createOscillator();
    carrier.type = 'sawtooth';
    carrier.frequency.value = 80;
    carrier.connect(filter);
    carrier.start();

    // FM modulator — slight sine wave detuning the carrier for texture
    modulator = ac.createOscillator();
    modulator.type = 'sine';
    modulator.frequency.value = 42; // slightly below carrier to create beating
    modulator.start();

    // Modulator gain — how much FM depth (semi-tones worth)
    modGain = ac.createGain();
    modGain.gain.value = 18; // Hz of FM deviation
    modulator.connect(modGain);
    modGain.connect(carrier.frequency); // FM into carrier frequency

    running = true;
  }

  async function resumeContext(): Promise<void> {
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  // ---------------------------------------------------------------------------
  // RPM / volume helpers
  // ---------------------------------------------------------------------------

  function applyRpm(rpm: number): void {
    if (!carrier || !filter || !masterGain || !ctx) return;
    const t = ctx.currentTime;
    const smooth = 0.05; // 50 ms ramp for smoothness

    carrier.frequency.setTargetAtTime(80 + rpm * 320, t, smooth);
    filter.frequency.setTargetAtTime(200 + rpm * 4000, t, smooth);
    masterGain.gain.setTargetAtTime(rpm * 0.3 * volumeScale, t, smooth);
  }

  // ---------------------------------------------------------------------------
  // Gate cleared blip
  // ---------------------------------------------------------------------------

  function playGateBlip(): void {
    if (!ctx || !masterGain) return;

    const ac = ctx;
    const blip = ac.createOscillator();
    blip.type = 'triangle';
    blip.frequency.value = 1200;

    const blipGain = ac.createGain();
    blipGain.gain.setValueAtTime(0.4, ac.currentTime);
    blipGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.08);

    blip.connect(blipGain);
    blipGain.connect(masterGain);
    blip.start(ac.currentTime);
    blip.stop(ac.currentTime + 0.08);

    // Cleanup once it stops
    blip.onended = () => {
      blip.disconnect();
      blipGain.disconnect();
    };
  }

  // ---------------------------------------------------------------------------
  // userGesture handler (from mobile.ts)
  // ---------------------------------------------------------------------------

  function onUserGesture(): void {
    resumeContext().catch(() => { /* ignore */ });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    attach(): void {
      // Build the audio chain lazily (AudioContext still suspended until gesture)
      buildChain();

      // Resume on first user gesture from mobile.ts
      window.addEventListener('userGesture', onUserGesture);

      // Subscribe to event bus
      unsubGateCleared = on('gateCleared', () => {
        playGateBlip();
      });

      unsubRpmUpdated = on('rpmUpdated', ({ rpm }) => {
        currentRpm = Math.max(0, Math.min(1, rpm));
        applyRpm(currentRpm);
      });
    },

    detach(): void {
      window.removeEventListener('userGesture', onUserGesture);
      unsubGateCleared?.();
      unsubRpmUpdated?.();
      unsubGateCleared = null;
      unsubRpmUpdated = null;

      // Stop oscillators
      try { carrier?.stop(); } catch { /* already stopped */ }
      try { modulator?.stop(); } catch { /* already stopped */ }

      carrier = null;
      modulator = null;
      modGain = null;
      filter = null;
      masterGain = null;
      running = false;

      ctx?.close().catch(() => { /* ignore */ });
      ctx = null;
    },

    setRpm(rpm: number): void {
      currentRpm = Math.max(0, Math.min(1, rpm));
      // Lazily build chain + resume context if called before attach()
      if (!running) buildChain();
      resumeContext().catch(() => { /* ignore */ });
      applyRpm(currentRpm);
    },

    setVolume(v: number): void {
      volumeScale = Math.max(0, Math.min(1, v / 100));
      // Re-apply current RPM so gain rescales immediately
      applyRpm(currentRpm);
    },
  };
}
