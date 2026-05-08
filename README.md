# FPV Drone Sim

Browser-based 3D FPV quadcopter simulator playable on PC and mobile. Built with Three.js + Rapier3D + Vite. Hosted on GitHub Pages.

> Linked from [JuiceAndTheJoe.github.io](https://juiceandthejoe.github.io) once the MVP is live. Tracks issue [#11](https://github.com/JuiceAndTheJoe/JuiceAndTheJoe.github.io/issues/11) on the portfolio repo.

## Status

This is **Stream A** of a parallel build. Only scaffolding + shared contracts + a minimal boot loop are in place. Streams B–H (physics, flight, input, render, world, ui, audio) replace stubbed modules independently.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173 — also exposed on LAN for phone testing
npm run build    # produces dist/
npm run preview  # serves the build locally
```

Node 20+ recommended.

## Architecture

```
                    Stream A (scaffolding + contracts)
                            │
       ┌────────┬───────┬───┴────┬────────┬────────┐
       ▼        ▼       ▼        ▼        ▼        ▼
       B        C       D        E        F       G + H
   physics  flight  input    render   world    ui + audio
       └────────┴───────┴────────┴────────┴────────┘
                            │
                   Integration sprint
                   (wiring lives in main.ts)
```

Every stream develops against the typed contracts in `src/shared/types.ts`. Streams never import each other directly — cross-stream signals go over the event bus in `src/shared/eventBus.ts`.

### Source layout

```
src/
├── main.ts              bootstrap, fixed-step loop, wiring
├── shared/
│   ├── types.ts         InputState, DroneState, FlightController, PhysicsWorld
│   ├── constants.ts     PHYSICS_HZ, GRAVITY, MASS_KG, ...
│   └── eventBus.ts      typed pub/sub
├── input/               Stream D — keyboard, gamepad, touch sticks
├── physics/             Stream B — Rapier3D wrapper, drone rigid body
├── flight/              Stream C — arcade vs acro controllers, tuning
├── render/              Stream E — Three.js scene, FPV camera, HUD
├── world/               Stream F — track, gates, props
├── ui/                  Stream G — pause menu, onboarding, mobile helpers
└── audio/               Stream H — Web Audio motor whine
```

### Stream contract

When you pick up a stream:
1. Read `src/shared/types.ts` — these interfaces are immutable without coordination.
2. Replace your stream's stubbed exports. Keep the public shape unchanged.
3. Add a `*-test.html` page under `public/` if you need to demo your module standalone.
4. Open a PR titled `Stream X: <module>`.

## Controls (target — implemented in Stream D)

| Action | Keyboard | Gamepad (Mode 2) | Touch |
|---|---|---|---|
| Throttle | Shift / Space | Left stick Y | Left virtual stick Y |
| Yaw | Q / E | Left stick X | Left virtual stick X |
| Pitch | W / S | Right stick Y | Right virtual stick Y |
| Roll | A / D | Right stick X | Right virtual stick X |
| Reset | R | Start | (menu button) |
| Mode toggle | Tab | Select | (menu button) |

## Flight modes

- **Arcade** (default) — auto-leveling, forgiving. Sticks command target attitude.
- **Acro** — true rate mode. Sticks command body rates. The realistic FPV feel.

Toggle at runtime via Tab / Select / settings overlay.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds with Vite and publishes `dist/` to GitHub Pages. Live URL: `https://juiceandthejoe.github.io/fpv-drone-sim/`.

`vite.config.ts` sets `base: '/fpv-drone-sim/'` so asset paths resolve in production.

## License

MIT
