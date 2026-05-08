/**
 * STREAM G — Pause menu + settings overlay
 *
 * createMenu() returns { attach, detach, isOpen }.
 * Esc toggles the overlay; emits 'paused'/'resumed' on the event bus.
 * Settings are persisted to localStorage under 'fpvSimSettings'.
 */

import { emit } from '../shared/eventBus.ts';
import type { FlightMode } from '../shared/types.ts';

// ---------------------------------------------------------------------------
// Settings singleton (localStorage-backed)
// ---------------------------------------------------------------------------

const LS_KEY = 'fpvSimSettings';

export interface SimSettings {
  mode: FlightMode;
  rateScale: number;   // 0.5 – 1.5
  expo: number;        // 1 – 4
  fov: number;         // 90 – 140
  volume: number;      // 0 – 100
}

const DEFAULTS: SimSettings = {
  mode: 'arcade',
  rateScale: 1.0,
  expo: 2.0,
  fov: 110,
  volume: 70,
};

function loadSettings(): SimSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SimSettings>) };
  } catch {
    // ignore
  }
  return { ...DEFAULTS };
}

function saveSettings(s: SimSettings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

/** Shared singleton so other modules can read current settings. */
export const settings: SimSettings = loadSettings();

// ---------------------------------------------------------------------------
// Styles (injected once)
// ---------------------------------------------------------------------------

const STYLE_ID = 'menu-styles';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #fpv-menu-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(4, 6, 12, 0.72);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
    }
    #fpv-menu-overlay.open {
      opacity: 1;
      pointer-events: all;
    }
    #fpv-menu-card {
      background: rgba(10, 14, 22, 0.6);
      border: 1px solid rgba(16, 241, 249, 0.25);
      border-radius: 14px;
      padding: 32px 36px;
      min-width: 320px;
      max-width: 480px;
      width: 90vw;
      box-shadow: 0 0 40px rgba(16, 241, 249, 0.08), 0 8px 32px rgba(0,0,0,0.6);
      color: #e8edf4;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    #fpv-menu-card h2 {
      margin: 0 0 24px;
      font-size: 1.4rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: #10f1f9;
      text-transform: uppercase;
    }
    .fpv-menu-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 18px;
      gap: 12px;
    }
    .fpv-menu-label {
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: #a8b8c8;
      white-space: nowrap;
    }
    .fpv-mode-group {
      display: flex;
      gap: 10px;
    }
    .fpv-mode-btn {
      padding: 6px 16px;
      border-radius: 20px;
      border: 1px solid rgba(16, 241, 249, 0.35);
      background: transparent;
      color: #a8b8c8;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: 0.04em;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .fpv-mode-btn.active {
      background: rgba(16, 241, 249, 0.18);
      color: #10f1f9;
      border-color: #10f1f9;
    }
    .fpv-menu-slider {
      flex: 1;
      accent-color: #10f1f9;
      height: 4px;
      cursor: pointer;
    }
    .fpv-slider-value {
      min-width: 38px;
      text-align: right;
      font-size: 0.8rem;
      color: #10f1f9;
      font-variant-numeric: tabular-nums;
    }
    .fpv-menu-divider {
      border: none;
      border-top: 1px solid rgba(16, 241, 249, 0.12);
      margin: 20px 0;
    }
    .fpv-menu-footer {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 24px;
    }
    .fpv-btn {
      padding: 8px 22px;
      border-radius: 8px;
      border: 1px solid rgba(16, 241, 249, 0.4);
      background: transparent;
      color: #e8edf4;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: 0.04em;
      transition: background 0.15s, color 0.15s;
    }
    .fpv-btn:hover {
      background: rgba(16, 241, 249, 0.15);
      color: #10f1f9;
    }
    .fpv-btn-accent {
      background: rgba(16, 241, 249, 0.18);
      color: #10f1f9;
      border-color: #10f1f9;
    }
    .fpv-btn-accent:hover {
      background: rgba(16, 241, 249, 0.32);
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// DOM builder
// ---------------------------------------------------------------------------

function buildOverlay(s: SimSettings): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'fpv-menu-overlay';

  const card = document.createElement('div');
  card.id = 'fpv-menu-card';

  // Title
  const title = document.createElement('h2');
  title.textContent = 'Settings';
  card.appendChild(title);

  // Mode toggle
  const modeRow = document.createElement('div');
  modeRow.className = 'fpv-menu-row';

  const modeLabel = document.createElement('span');
  modeLabel.className = 'fpv-menu-label';
  modeLabel.textContent = 'Flight Mode';

  const modeGroup = document.createElement('div');
  modeGroup.className = 'fpv-mode-group';

  const modes: FlightMode[] = ['arcade', 'acro'];
  const modeButtons: HTMLButtonElement[] = [];

  modes.forEach((m) => {
    const btn = document.createElement('button');
    btn.className = 'fpv-mode-btn' + (s.mode === m ? ' active' : '');
    btn.textContent = m.charAt(0).toUpperCase() + m.slice(1);
    btn.addEventListener('click', () => {
      if (s.mode === m) return;
      s.mode = m;
      saveSettings(s);
      modeButtons.forEach((b, i) => {
        b.classList.toggle('active', modes[i] === m);
      });
      emit('modeChanged', { mode: m });
    });
    modeButtons.push(btn);
    modeGroup.appendChild(btn);
  });

  modeRow.appendChild(modeLabel);
  modeRow.appendChild(modeGroup);
  card.appendChild(modeRow);

  // Slider helper
  function makeSlider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    format: (v: number) => string,
    onChange: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fpv-menu-row';

    const lbl = document.createElement('span');
    lbl.className = 'fpv-menu-label';
    lbl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'fpv-menu-slider';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);

    const val = document.createElement('span');
    val.className = 'fpv-slider-value';
    val.textContent = format(value);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      val.textContent = format(v);
      onChange(v);
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(val);
    return row;
  }

  const hr = document.createElement('hr');
  hr.className = 'fpv-menu-divider';
  card.appendChild(hr);

  card.appendChild(makeSlider('Rate Scale', 0.5, 1.5, 0.05, s.rateScale,
    (v) => `${v.toFixed(2)}×`,
    (v) => { s.rateScale = v; saveSettings(s); },
  ));

  card.appendChild(makeSlider('Expo', 1, 4, 0.1, s.expo,
    (v) => v.toFixed(1),
    (v) => { s.expo = v; saveSettings(s); },
  ));

  card.appendChild(makeSlider('FOV', 90, 140, 1, s.fov,
    (v) => `${Math.round(v)}°`,
    (v) => { s.fov = v; saveSettings(s); },
  ));

  card.appendChild(makeSlider('Audio Volume', 0, 100, 1, s.volume,
    (v) => `${Math.round(v)}%`,
    (v) => { s.volume = v; saveSettings(s); },
  ));

  const hr2 = document.createElement('hr');
  hr2.className = 'fpv-menu-divider';
  card.appendChild(hr2);

  // Footer buttons
  const footer = document.createElement('div');
  footer.className = 'fpv-menu-footer';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'fpv-btn';
  resetBtn.textContent = 'Reset Position';
  resetBtn.addEventListener('click', () => {
    emit('reset', undefined);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'fpv-btn fpv-btn-accent';
  closeBtn.textContent = 'Close';

  footer.appendChild(resetBtn);
  footer.appendChild(closeBtn);
  card.appendChild(footer);
  overlay.appendChild(card);

  return { overlay, closeBtn } as unknown as HTMLElement & {
    overlay: HTMLElement;
    closeBtn: HTMLButtonElement;
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMenu(): { attach(): void; detach(): void; isOpen(): boolean } {
  injectStyles();

  const s = settings;
  let overlay: HTMLElement | null = null;
  let closeBtn: HTMLButtonElement | null = null;
  let _open = false;

  function open(): void {
    if (_open || !overlay) return;
    _open = true;
    overlay.classList.add('open');
    emit('paused', undefined);
  }

  function close(): void {
    if (!_open || !overlay) return;
    _open = false;
    overlay.classList.remove('open');
    emit('resumed', undefined);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      _open ? close() : open();
    }
  }

  function onOverlayClick(e: MouseEvent): void {
    if (e.target === overlay) close();
  }

  return {
    attach(): void {
      if (overlay) return;

      const built = buildOverlay(s);
      // buildOverlay returns a plain object, not an HTMLElement — cast carefully
      const { overlay: ov, closeBtn: cb } = built as unknown as {
        overlay: HTMLElement;
        closeBtn: HTMLButtonElement;
      };
      overlay = ov;
      closeBtn = cb;

      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', onOverlayClick);
      document.addEventListener('keydown', onKeyDown);
      document.body.appendChild(overlay);
    },

    detach(): void {
      if (!overlay) return;
      document.removeEventListener('keydown', onKeyDown);
      overlay.removeEventListener('click', onOverlayClick);
      overlay.remove();
      overlay = null;
      closeBtn = null;
      _open = false;
    },

    isOpen(): boolean {
      return _open;
    },
  };
}
