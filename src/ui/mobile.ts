/**
 * STREAM G — Mobile UX helpers
 *
 * createMobileHelpers() returns { attach, detach }.
 * - Portrait + coarse-pointer → "Rotate to landscape" full-screen overlay.
 *   Reappears if the user rotates back to portrait.
 * - First user gesture → best-effort requestFullscreen().
 * - First user gesture → dispatch 'userGesture' on window (lets motor.ts
 *   resume the AudioContext).
 */

const STYLE_ID = 'mobile-styles';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #fpv-rotate-prompt {
      position: fixed;
      inset: 0;
      z-index: 1200;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(4, 6, 12, 0.95);
      color: #e8edf4;
      font-family: 'Segoe UI', system-ui, sans-serif;
      text-align: center;
      gap: 16px;
      padding: 24px;
    }
    #fpv-rotate-prompt .fpv-rotate-icon {
      font-size: 3.5rem;
      animation: fpv-rotate-spin 2s ease-in-out infinite;
    }
    @keyframes fpv-rotate-spin {
      0%   { transform: rotate(0deg); }
      40%  { transform: rotate(90deg); }
      60%  { transform: rotate(90deg); }
      100% { transform: rotate(0deg); }
    }
    #fpv-rotate-prompt h2 {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 700;
      color: #10f1f9;
    }
    #fpv-rotate-prompt p {
      margin: 0;
      font-size: 0.85rem;
      color: #6e8a9e;
    }
    #fpv-rotate-dismiss {
      margin-top: 8px;
      padding: 8px 24px;
      border-radius: 8px;
      border: 1px solid rgba(16, 241, 249, 0.4);
      background: transparent;
      color: #10f1f9;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: 0.04em;
      transition: background 0.15s;
    }
    #fpv-rotate-dismiss:hover {
      background: rgba(16, 241, 249, 0.12);
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCoarsePointer(): boolean {
  return matchMedia('(pointer: coarse)').matches;
}

function isPortrait(): boolean {
  return matchMedia('(orientation: portrait)').matches;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMobileHelpers(): { attach(): void; detach(): void } {
  injectStyles();

  let rotatePrompt: HTMLElement | null = null;
  let orientationMq: MediaQueryList | null = null;
  let gestureHandled = false;
  let attached = false;

  // --- Rotate-to-landscape overlay ---

  function showRotatePrompt(): void {
    if (rotatePrompt) return;
    const el = document.createElement('div');
    el.id = 'fpv-rotate-prompt';
    el.innerHTML = `
      <span class="fpv-rotate-icon">📱</span>
      <h2>Rotate to Landscape</h2>
      <p>For the best experience, please rotate your device.</p>
      <button id="fpv-rotate-dismiss">Continue anyway</button>
    `;
    document.body.appendChild(el);
    rotatePrompt = el;

    const btn = el.querySelector<HTMLButtonElement>('#fpv-rotate-dismiss');
    btn?.addEventListener('click', () => {
      hideRotatePrompt();
    });
  }

  function hideRotatePrompt(): void {
    if (!rotatePrompt) return;
    rotatePrompt.remove();
    rotatePrompt = null;
  }

  function updateRotatePrompt(): void {
    if (!isCoarsePointer()) return; // desktop — never show
    if (isPortrait()) {
      showRotatePrompt();
    } else {
      hideRotatePrompt();
    }
  }

  // --- First gesture handler ---

  function onFirstGesture(): void {
    if (gestureHandled) return;
    gestureHandled = true;

    // 1. Dispatch userGesture so audio can resume AudioContext
    window.dispatchEvent(new Event('userGesture'));

    // 2. Best-effort fullscreen
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {
        // swallow — iOS/desktop may deny
      });
    }

    // Remove listeners — we only need the first gesture
    document.removeEventListener('touchstart', onFirstGesture, { capture: true });
    document.removeEventListener('click', onFirstGesture, { capture: true });
  }

  return {
    attach(): void {
      if (attached) return;
      attached = true;

      // Portrait detection
      orientationMq = matchMedia('(orientation: portrait)');
      orientationMq.addEventListener('change', updateRotatePrompt);
      updateRotatePrompt(); // check immediately

      // First-gesture listeners (capture phase so they fire before anything else)
      document.addEventListener('touchstart', onFirstGesture, { capture: true, once: false });
      document.addEventListener('click', onFirstGesture, { capture: true, once: false });
    },

    detach(): void {
      if (!attached) return;
      attached = false;

      if (orientationMq) {
        orientationMq.removeEventListener('change', updateRotatePrompt);
        orientationMq = null;
      }

      hideRotatePrompt();

      document.removeEventListener('touchstart', onFirstGesture, { capture: true });
      document.removeEventListener('click', onFirstGesture, { capture: true });
    },
  };
}
