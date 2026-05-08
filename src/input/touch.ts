/**
 * STREAM D — Touch input source
 *
 * Two virtual joysticks rendered as canvas overlays:
 *
 *   Left stick  (bottom-left,  ~30vmin circle):
 *     X-axis → yaw      (springs back to 0 on release)
 *     Y-axis → throttle (springs back to 0.5 on release — consistent with gamepad center)
 *
 *   Right stick (bottom-right, ~30vmin circle):
 *     X-axis → roll     (springs back to 0)
 *     Y-axis → pitch    (springs back to 0; push up = negative = nose down)
 *
 * The canvases are hidden (display:none) unless a coarse pointer or ontouchstart
 * is detected — so desktop users without touch never see them.
 *
 * Controls bar (bottom-center):
 *   [M] button → modeToggle (edge-triggered)
 *   [R] button → reset      (edge-triggered)
 *
 * Throttle strategy: spring-to-0.5 on release.
 *   Rationale: consistent with gamepad center, and avoids surprise cut-throttle
 *   when a finger lifts unexpectedly. Pilot can intentionally drive it to 0.
 */
import type { InputState } from '../shared/types.ts';
import type { InputSource } from './keyboard.ts';

// ── Layout constants ────────────────────────────────────────────────────────
/** Stick diameter in vmin units. */
const STICK_SIZE_VMIN = 30;
/** Margin from screen edges in vmin. */
const STICK_MARGIN_VMIN = 4;
/** Knob radius as fraction of stick radius. */
const KNOB_RADIUS_FRAC = 0.28;
/** Canvas z-index. */
const Z_INDEX = '9999';

// ── Colors ────────────────────────────────────────────────────────────────
const COLOR_WELL_FILL   = 'rgba(255,255,255,0.10)';
const COLOR_WELL_STROKE = 'rgba(255,255,255,0.30)';
const COLOR_KNOB_FILL   = 'rgba(255,255,255,0.55)';
const COLOR_BTN_BG      = 'rgba(30,30,30,0.60)';
const COLOR_BTN_TEXT    = 'rgba(255,255,255,0.90)';
const COLOR_BTN_ACTIVE  = 'rgba(255,200,50,0.80)';

function vmin(v: number): number {
  return (Math.min(window.innerWidth, window.innerHeight) * v) / 100;
}

interface StickState {
  /** -1..1 normalized position */
  x: number;
  /** -1..1 normalized position (up = negative) */
  y: number;
  activeId: number | null;
}

export function createTouchSource(): InputSource {
  let attached = false;
  let leftCanvas:  HTMLCanvasElement | null = null;
  let rightCanvas: HTMLCanvasElement | null = null;
  let btnBar: HTMLDivElement | null = null;

  const left:  StickState = { x: 0, y: 0, activeId: null };
  const right: StickState = { x: 0, y: 0, activeId: null };

  let pendingModeToggle = false;
  let pendingReset      = false;

  // ── Touch device detection ──────────────────────────────────────────────
  function isTouchDevice(): boolean {
    return 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches;
  }

  // ── Canvas creation ─────────────────────────────────────────────────────
  function makeCanvas(side: 'left' | 'right'): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.style.position   = 'fixed';
    c.style.bottom     = `${vmin(STICK_MARGIN_VMIN)}px`;
    c.style.zIndex     = Z_INDEX;
    c.style.touchAction = 'none';
    const size = vmin(STICK_SIZE_VMIN);
    c.width  = size;
    c.height = size;
    c.style.width  = `${size}px`;
    c.style.height = `${size}px`;
    if (side === 'left') {
      c.style.left = `${vmin(STICK_MARGIN_VMIN)}px`;
    } else {
      c.style.right = `${vmin(STICK_MARGIN_VMIN)}px`;
    }
    c.style.borderRadius = '50%';
    c.style.display      = isTouchDevice() ? 'block' : 'none';
    return c;
  }

  function makeButtonBar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.style.position  = 'fixed';
    bar.style.bottom    = `${vmin(STICK_MARGIN_VMIN)}px`;
    bar.style.left      = '50%';
    bar.style.transform = 'translateX(-50%)';
    bar.style.zIndex    = Z_INDEX;
    bar.style.display   = isTouchDevice() ? 'flex' : 'none';
    bar.style.gap       = '12px';

    const btnM = makeButton('M', () => { pendingModeToggle = true; });
    const btnR = makeButton('R', () => { pendingReset      = true; });
    bar.appendChild(btnM);
    bar.appendChild(btnR);
    return bar;
  }

  function makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      width:           '44px',
      height:          '44px',
      borderRadius:    '50%',
      border:          '2px solid rgba(255,255,255,0.4)',
      background:      COLOR_BTN_BG,
      color:           COLOR_BTN_TEXT,
      fontSize:        '16px',
      fontWeight:      'bold',
      cursor:          'pointer',
      userSelect:      'none',
      WebkitUserSelect: 'none',
      touchAction:     'manipulation',
    });
    let flashTimer = 0;
    const flash = (): void => {
      btn.style.background = COLOR_BTN_ACTIVE;
      clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        btn.style.background = COLOR_BTN_BG;
      }, 150);
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onClick();
      flash();
    });
    return btn;
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  function drawStick(canvas: HTMLCanvasElement, nx: number, ny: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r  = Math.min(w, h) / 2 - 4;
    const kr = r * KNOB_RADIUS_FRAC;

    ctx.clearRect(0, 0, w, h);

    // Well
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle   = COLOR_WELL_FILL;
    ctx.fill();
    ctx.strokeStyle = COLOR_WELL_STROKE;
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Knob (clamped inside well already in pointer handler)
    const kx = cx + nx * (r - kr);
    const ky = cy + ny * (r - kr);
    ctx.beginPath();
    ctx.arc(kx, ky, kr, 0, Math.PI * 2);
    ctx.fillStyle = COLOR_KNOB_FILL;
    ctx.fill();
  }

  // ── Pointer math helpers ─────────────────────────────────────────────────
  function pointerNorm(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): { nx: number; ny: number } {
    const rect = canvas.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    const r    = Math.min(rect.width, rect.height) / 2;
    const dx   = clientX - cx;
    const dy   = clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const scale = dist > r ? r / dist : 1;
    return { nx: (dx * scale) / r, ny: (dy * scale) / r };
  }

  // ── Touch / Pointer event handlers ─────────────────────────────────────
  function bindStick(
    canvas: HTMLCanvasElement,
    stick: StickState,
    defaultY: number,
    springY: boolean,
  ): void {
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (stick.activeId === null) {
          stick.activeId = t.identifier;
          const { nx, ny } = pointerNorm(canvas, t.clientX, t.clientY);
          stick.x = nx;
          stick.y = ny;
          drawStick(canvas, stick.x, stick.y);
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stick.activeId) {
          const { nx, ny } = pointerNorm(canvas, t.clientX, t.clientY);
          stick.x = nx;
          stick.y = ny;
          drawStick(canvas, stick.x, stick.y);
        }
      }
    }, { passive: false });

    const onEnd = (e: TouchEvent): void => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stick.activeId) {
          stick.activeId = null;
          stick.x = 0;
          stick.y = springY ? defaultY : stick.y;
          drawStick(canvas, stick.x, stick.y);
        }
      }
    };
    canvas.addEventListener('touchend',    onEnd, { passive: false });
    canvas.addEventListener('touchcancel', onEnd, { passive: false });

    // Initial draw
    stick.y = defaultY;
    drawStick(canvas, stick.x, stick.y);
  }

  function read(): InputState {
    // Left stick: Y = throttle (up = negative Y = full throttle → invert + remap)
    // ny: -1 = up (full throttle), +1 = down (no throttle), 0 = center (0.5)
    const throttle = (1 - left.y) / 2;   // same formula as gamepad
    const yaw      = left.x;

    // Right stick: Y = pitch (push up = ny -1 = nose down = pitch -1)
    const pitch = right.y;   // ny already: up = -1, matches "push forward = -1"
    const roll  = right.x;

    return {
      throttle: Math.max(0, Math.min(1, throttle)),
      yaw:      Math.max(-1, Math.min(1, yaw)),
      pitch:    Math.max(-1, Math.min(1, pitch)),
      roll:     Math.max(-1, Math.min(1, roll)),
      modeToggle: pendingModeToggle,
      reset:      pendingReset,
    };
  }

  function clearEdges(): void {
    pendingModeToggle = false;
    pendingReset      = false;
  }

  function attach(): void {
    if (attached) return;
    attached = true;

    leftCanvas  = makeCanvas('left');
    rightCanvas = makeCanvas('right');
    btnBar      = makeButtonBar();

    document.body.appendChild(leftCanvas);
    document.body.appendChild(rightCanvas);
    document.body.appendChild(btnBar);

    // Left stick: throttle springs to 0.5 (center), yaw springs to 0
    bindStick(leftCanvas,  left,  0, true);   // defaultY=0 → (1-0)/2 = 0.5 throttle
    // Right stick: both axes spring to 0
    bindStick(rightCanvas, right, 0, true);

    // Resize handler: rebuild canvases on orientation change
    window.addEventListener('resize', onResize);
  }

  function onResize(): void {
    if (!leftCanvas || !rightCanvas || !btnBar) return;
    const size = vmin(STICK_SIZE_VMIN);
    for (const c of [leftCanvas, rightCanvas]) {
      c.width  = size;
      c.height = size;
      c.style.width  = `${size}px`;
      c.style.height = `${size}px`;
      c.style.bottom = `${vmin(STICK_MARGIN_VMIN)}px`;
    }
    leftCanvas.style.left  = `${vmin(STICK_MARGIN_VMIN)}px`;
    rightCanvas.style.right = `${vmin(STICK_MARGIN_VMIN)}px`;
    btnBar.style.bottom     = `${vmin(STICK_MARGIN_VMIN)}px`;
    drawStick(leftCanvas,  left.x,  left.y);
    drawStick(rightCanvas, right.x, right.y);
  }

  function detach(): void {
    if (!attached) return;
    attached = false;
    window.removeEventListener('resize', onResize);
    leftCanvas?.remove();
    rightCanvas?.remove();
    btnBar?.remove();
    leftCanvas  = null;
    rightCanvas = null;
    btnBar      = null;
    left.x  = 0; left.y  = 0; left.activeId  = null;
    right.x = 0; right.y = 0; right.activeId = null;
    pendingModeToggle = false;
    pendingReset      = false;
  }

  return { attach, detach, read, clearEdges };
}
