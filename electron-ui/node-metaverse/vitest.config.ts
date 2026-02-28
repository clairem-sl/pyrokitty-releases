import { defineConfig } from 'vitest/config';

export default defineConfig({
    esbuild: {
        target: 'es2020',
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.json'],
    },
    test: {
        include: ['lib/**/*.spec.ts'],
    },
});
