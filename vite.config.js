import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';

// personal dev-only tools live in local/ (git-ignored)
const local = existsSync('./local/plugin.js') ? [(await import('./local/plugin.js')).default()] : [];

// relative base so the built playground works from any path (GitHub Pages included)
export default defineConfig({ base: './', plugins: local });
