import { defineConfig } from 'vite';

// Hosted on GitHub Pages at https://juiceandthejoe.github.io/fpv-drone-sim/
// `base` must match the repo name so asset URLs resolve in production.
export default defineConfig({
  base: '/fpv-drone-sim/',
  server: {
    host: true, // expose to LAN so a phone on the same network can connect
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
