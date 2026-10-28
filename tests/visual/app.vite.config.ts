import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
// Screen preview harness: identity hooks are replaced; services are mocked in app.tsx.
const hooks = resolve('tests/visual/app-hooks.tsx');
export default defineConfig({ plugins: [react()], optimizeDeps: { entries: ['tests/visual/app.html'] }, resolve: { alias: [
  { find: /^\.\/usePermissions$/, replacement: hooks },
  { find: /^.*\/contexts\/AuthContext$/, replacement: hooks },
  { find: /^.*\/contexts\/BusinessContext$/, replacement: hooks },
  { find: /^.*\/hooks\/usePermissions$/, replacement: hooks },
  { find: /^.*\/components\/TrialStatus$/, replacement: hooks },
] } });
