import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.spec.ts', 'e2e/**/*.e2e-spec.ts'],
        testTimeout: 60_000,
        hookTimeout: 180_000,
        // Each e2e file boots its own Vendure server on a fixed port.
        fileParallelism: false,
        pool: 'forks',
    },
    // NestJS DI needs emitDecoratorMetadata, which esbuild does not support.
    plugins: [swc.vite({ jsc: { transform: { useDefineForClassFields: false } } })],
});
