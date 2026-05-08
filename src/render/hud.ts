/**
 * STREAM E — HUD overlay (DOM, not WebGL)
 *
 * Throttle bar, mode badge, FPS counter, speed readout.
 * Appends a single <div id="hud"> to document.body on first construction.
 * Styled inline; no external CSS dependency.
 */
import type { FlightMode } from '../shared/types.ts';

export interface HudPayload {
  throttle: number;    // 0..1
  fps: number;         // smoothed frames-per-second
  position: [number, number, number];
  /** Magnitude of linearVelocity in m/s — HUD converts to km/h. */
  speedMs: number;
}

export interface HudHandle {
  /** Called every render frame with fresh telemetry. */
  update(payload: HudPayload): void;
  /** Called when the flight-mode event fires. */
  setMode(mode: FlightMode): void;
  /** Remove the overlay from the DOM. */
  dispose(): void;
}

// ── Style sheet (injected once) ─────────────────────────────────────────────

const STYLE_ID = 'hud-styles';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* HUD root */
    #hud {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 5;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }

    /* Shared glass pill style */
    .hud-pill {
      background: rgba(10, 14, 22, 0.60);
      border: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border-radius: 6px;
      color: #10f1f9;
    }

    /* ── Mode badge ── top-left ── */
    #hud-mode {
      position: absolute;
      top: 16px;
      left: 16px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    /* Acro mode gets a warm accent */
    #hud-mode.acro {
      color: #ff9f0a;
      border-color: rgba(255, 159, 10, 0.25);
    }

    /* ── FPS counter ── top-right ── */
    #hud-fps {
      position: absolute;
      top: 16px;
      right: 16px;
      padding: 4px 10px;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      font-family: 'Courier New', Courier, monospace;
      letter-spacing: 0.04em;
      min-width: 64px;
      text-align: right;
    }

    /* ── Speed readout ── bottom-center ── */
    #hud-speed {
      position: absolute;
      bottom: 72px;
      left: 50%;
      transform: translateX(-50%);
      padding: 4px 14px;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.06em;
      white-space: nowrap;
    }

    /* ── Throttle bar ── bottom-right ── */
    #hud-throttle-wrap {
      position: absolute;
      right: 20px;
      bottom: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    #hud-throttle-label {
      font-size: 9px;
      letter-spacing: 0.1em;
      color: rgba(16, 241, 249, 0.55);
      text-transform: uppercase;
    }
    #hud-throttle-track {
      width: 10px;
      height: 80px;
      background: rgba(10, 14, 22, 0.60);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 5px;
      overflow: hidden;
      display: flex;
      flex-direction: column-reverse; /* fill from bottom */
    }
    #hud-throttle-fill {
      width: 100%;
      background: #10f1f9;
      border-radius: 4px;
      transition: height 0.05s linear;
      /* height set via JS */
    }
  `;
  document.head.appendChild(style);
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createHud(): HudHandle {
  injectStyles();

  // Remove any stale HUD from a previous hot-reload
  document.getElementById('hud')?.remove();

  const root = document.createElement('div');
  root.id = 'hud';

  // Mode badge
  const modeBadge = document.createElement('div');
  modeBadge.id = 'hud-mode';
  modeBadge.className = 'hud-pill';
  modeBadge.textContent = 'ARCADE';

  // FPS counter
  const fpsEl = document.createElement('div');
  fpsEl.id = 'hud-fps';
  fpsEl.className = 'hud-pill';
  fpsEl.textContent = '-- fps';

  // Speed readout
  const speedEl = document.createElement('div');
  speedEl.id = 'hud-speed';
  speedEl.className = 'hud-pill';
  speedEl.textContent = '0 km/h';

  // Throttle bar
  const throttleWrap = document.createElement('div');
  throttleWrap.id = 'hud-throttle-wrap';

  const throttleLabel = document.createElement('div');
  throttleLabel.id = 'hud-throttle-label';
  throttleLabel.textContent = 'THR';

  const throttleTrack = document.createElement('div');
  throttleTrack.id = 'hud-throttle-track';

  const throttleFill = document.createElement('div');
  throttleFill.id = 'hud-throttle-fill';
  throttleFill.style.height = '0%';

  throttleTrack.appendChild(throttleFill);
  throttleWrap.appendChild(throttleLabel);
  throttleWrap.appendChild(throttleTrack);

  root.appendChild(modeBadge);
  root.appendChild(fpsEl);
  root.appendChild(speedEl);
  root.appendChild(throttleWrap);
  document.body.appendChild(root);

  // ── Update helpers ──────────────────────────────────────────────────────

  function update(payload: HudPayload): void {
    // Throttle bar: clamp 0..1 → 0..100%
    const pct = Math.max(0, Math.min(1, payload.throttle)) * 100;
    throttleFill.style.height = `${pct}%`;

    // FPS
    fpsEl.textContent = `${Math.round(payload.fps)} fps`;

    // Speed (m/s → km/h)
    const kmh = payload.speedMs * 3.6;
    speedEl.textContent = `${Math.round(kmh)} km/h`;
  }

  function setMode(mode: FlightMode): void {
    modeBadge.textContent = mode === 'acro' ? 'ACRO' : 'ARCADE';
    if (mode === 'acro') {
      modeBadge.classList.add('acro');
    } else {
      modeBadge.classList.remove('acro');
    }
  }

  function dispose(): void {
    root.remove();
  }

  return { update, setMode, dispose };
}
