import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], worker: { format: 'es' }, build: { rollupOptions: { output: { manualChunks(id) { if (id.includes('node_modules')) { if (id.includes('@codemirror') || id.includes('@lezer')) return 'editor'; if (id.includes('react')) return 'react'; } } } } }, test: { include: ['tests/**/*.test.ts'] }, server: { host: '0.0.0.0' } });
