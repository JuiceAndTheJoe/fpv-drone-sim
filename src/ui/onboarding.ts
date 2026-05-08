/**
 * STREAM G — First-load onboarding overlay
 *
 * createOnboarding() returns { attach, detach }.
 * On attach(), checks localStorage 'fpvSimOnboarded'. If falsy, shows a
 * welcome card with platform-appropriate control hints and Arcade/Acro CTAs.
 * Persists 'fpvSimOnboarded'='1' and emits 'modeChanged' on click.
 */

import { emit } from '../shared/eventBus.ts';
import type { FlightMode } from '../shared/types.ts';

const LS_ONBOARDED = 'fpvSimOnboarded';

// ---------------------------------------------------------------------------
// Styles (share the menu-styles id or inject separately)
// ---------------------------------------------------------------------------

const STYLE_ID = 'onboarding-styles';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #fpv-onboarding {
      position: fixed;
      inset: 0;
      z-index: 1100;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(4, 6, 12, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    #fpv-onboarding-card {
      background: rgba(10, 14, 22, 0.6);
      border: 1px solid rgba(16, 241, 249, 0.25);
      border-radius: 16px;
      padding: 36px 40px;
      min-width: 320px;
      max-width: 500px;
      width: 90vw;
      box-shadow: 0 0 50px rgba(16, 241, 249, 0.08), 0 12px 40px rgba(0,0,0,0.7);
      color: #e8edf4;
      font-family: 'Segoe UI', system-ui, sans-serif;
      text-align: center;
    }
    #fpv-onboarding-card h1 {
      margin: 0 0 8px;
      font-size: 1.6rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      color: #10f1f9;
    }
    #fpv-onboarding-card .fpv-ob-sub {
      font-size: 0.85rem;
      color: #6e8a9e;
      margin-bottom: 28px;
    }
    .fpv-ob-diagram {
      background: rgba(16, 241, 249, 0.04);
      border: 1px solid rgba(16, 241, 249, 0.12);
      border-radius: 10px;
      padding: 18px 20px;
      margin-bottom: 28px;
      text-align: left;
      font-size: 0.82rem;
      line-height: 1.7;
      color: #a8b8c8;
    }
    .fpv-ob-diagram strong {
      color: #10f1f9;
      font-weight: 700;
    }
    .fpv-ob-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 6px;
    }
    .fpv-ob-row:last-child {
      margin-bottom: 0;
    }
    .fpv-ob-key {
      background: rgba(16, 241, 249, 0.12);
      border: 1px solid rgba(16, 241, 249, 0.3);
      border-radius: 5px;
      padding: 2px 8px;
      font-size: 0.78rem;
      color: #10f1f9;
      white-space: nowrap;
      font-family: monospace;
    }
    .fpv-ob-ctas {
      display: flex;
      gap: 12px;
      flex-direction: column;
    }
    .fpv-ob-btn {
      display: block;
      width: 100%;
      padding: 14px 20px;
      border-radius: 10px;
      border: 1px solid rgba(16, 241, 249, 0.4);
      background: transparent;
      color: #e8edf4;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      letter-spacing: 0.04em;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .fpv-ob-btn:hover {
      background: rgba(16, 241, 249, 0.12);
      color: #10f1f9;
    }
    .fpv-ob-btn-primary {
      background: rgba(16, 241, 249, 0.18);
      color: #10f1f9;
      border-color: #10f1f9;
    }
    .fpv-ob-btn-primary:hover {
      background: rgba(16, 241, 249, 0.30);
    }
    .fpv-ob-note {
      font-size: 0.75rem;
      color: #4a6070;
      margin-top: 18px;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

function isTouch(): boolean {
  return ('ontouchstart' in window) || matchMedia('(pointer: coarse)').matches;
}

// ---------------------------------------------------------------------------
// DOM builder
// ---------------------------------------------------------------------------

function buildCard(dismiss: (mode: FlightMode) => void): HTMLElement {
  const card = document.createElement('div');
  card.id = 'fpv-onboarding-card';

  const h1 = document.createElement('h1');
  h1.textContent = 'Welcome to FPV Drone Sim';
  card.appendChild(h1);

  const sub = document.createElement('p');
  sub.className = 'fpv-ob-sub';
  sub.textContent = 'Choose a flight mode and take to the skies.';
  card.appendChild(sub);

  // Control diagram
  const diagram = document.createElement('div');
  diagram.className = 'fpv-ob-diagram';

  if (isTouch()) {
    diagram.innerHTML = `
      <div class="fpv-ob-row"><strong>Left Stick</strong></div>
      <div class="fpv-ob-row" style="margin-left:12px">↕ Throttle &nbsp;·&nbsp; ↔ Yaw</div>
      <div class="fpv-ob-row" style="margin-top:8px"><strong>Right Stick</strong></div>
      <div class="fpv-ob-row" style="margin-left:12px">↕ Pitch &nbsp;·&nbsp; ↔ Roll</div>
    `;
  } else {
    diagram.innerHTML = `
      <div class="fpv-ob-row"><span class="fpv-ob-key">W/S</span>&nbsp;Pitch forward / back</div>
      <div class="fpv-ob-row"><span class="fpv-ob-key">A/D</span>&nbsp;Roll left / right</div>
      <div class="fpv-ob-row"><span class="fpv-ob-key">Q/E</span>&nbsp;Yaw left / right</div>
      <div class="fpv-ob-row"><span class="fpv-ob-key">Shift</span>&nbsp;Throttle up &nbsp;·&nbsp; <span class="fpv-ob-key">Ctrl</span>&nbsp;Down</div>
      <div class="fpv-ob-row"><span class="fpv-ob-key">Tab</span>&nbsp;Toggle Arcade / Acro</div>
      <div class="fpv-ob-row"><span class="fpv-ob-key">R</span>&nbsp;Reset drone &nbsp;·&nbsp; <span class="fpv-ob-key">Esc</span>&nbsp;Settings</div>
      <div class="fpv-ob-row" style="margin-top:6px;color:#6e8a9e">Gamepad supported (Mode 2 layout)</div>
    `;
  }

  card.appendChild(diagram);

  // CTAs
  const ctas = document.createElement('div');
  ctas.className = 'fpv-ob-ctas';

  const arcadeBtn = document.createElement('button');
  arcadeBtn.className = 'fpv-ob-btn fpv-ob-btn-primary';
  arcadeBtn.textContent = 'Start in Arcade (Recommended)';
  arcadeBtn.addEventListener('click', () => dismiss('arcade'));

  const acroBtn = document.createElement('button');
  acroBtn.className = 'fpv-ob-btn';
  acroBtn.textContent = 'Try Acro — Advanced';
  acroBtn.addEventListener('click', () => dismiss('acro'));

  ctas.appendChild(arcadeBtn);
  ctas.appendChild(acroBtn);
  card.appendChild(ctas);

  const note = document.createElement('p');
  note.className = 'fpv-ob-note';
  note.textContent = 'You can change flight mode any time via Settings (Esc).';
  card.appendChild(note);

  return card;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createOnboarding(): { attach(): void; detach(): void } {
  injectStyles();

  let overlay: HTMLElement | null = null;

  function dismiss(mode: FlightMode): void {
    localStorage.setItem(LS_ONBOARDED, '1');
    emit('modeChanged', { mode });
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  return {
    attach(): void {
      if (localStorage.getItem(LS_ONBOARDED)) return;
      if (overlay) return;

      overlay = document.createElement('div');
      overlay.id = 'fpv-onboarding';

      const card = buildCard(dismiss);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    },

    detach(): void {
      if (!overlay) return;
      overlay.remove();
      overlay = null;
    },
  };
}
