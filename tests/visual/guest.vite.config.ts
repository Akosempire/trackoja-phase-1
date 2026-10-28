import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
// Guest screen preview harness (auth, welcome, onboarding, landing). Identity is
// replaced with a signed-in-but-not-onboarded user; services are mocked in guest.tsx.
const hooks = resolve('tests/visual/app-hooks.tsx');
export default defineConfig({ plugins: [react()], optimizeDeps: { entries: ['tests/visual/guest.html'] }, resolve: { alias: [
  { find: /^.*\/contexts\/AuthContext$/, replacement: hooks },
] } });
