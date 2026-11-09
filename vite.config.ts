import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], worker: { format: 'es' }, test: { include: ['tests/**/*.test.ts'] }, server: { host: '0.0.0.0' } });
