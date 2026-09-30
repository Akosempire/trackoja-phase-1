import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
// Only this isolated test server replaces identity hooks. Production config is untouched.
const hooks = resolve('tests/visual/owner-hooks.tsx');
export default defineConfig({ plugins: [react()], optimizeDeps: { entries: ['tests/visual/owner.html'] }, resolve: { alias: [
  { find: /^\.\/usePermissions$/, replacement: hooks },
  { find: /^.*\/contexts\/AuthContext$/, replacement: hooks },
  { find: /^.*\/contexts\/BusinessContext$/, replacement: hooks },
  { find: /^.*\/hooks\/usePermissions$/, replacement: hooks },
  { find: /^.*\/components\/TrialStatus$/, replacement: hooks },
] } });
