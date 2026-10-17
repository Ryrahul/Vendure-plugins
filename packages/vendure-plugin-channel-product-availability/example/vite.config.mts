// Dashboard: no extra config is needed. vendureDashboardPlugin discovers the
// plugin's `dashboard` entry from your vendure-config automatically.
import { vendureDashboardPlugin } from '@vendure/dashboard/vite';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { defineConfig } from 'vite';

export default defineConfig({
    base: '/dashboard',
    build: { outDir: join(__dirname, 'dist/dashboard') },
    plugins: [
        vendureDashboardPlugin({
            vendureConfigPath: pathToFileURL('./vendure-config.ts'),
            api: { host: 'http://localhost', port: 3000 },
            gqlOutputPath: './gql',
        }),
    ],
    resolve: { alias: { '@/gql': resolve(__dirname, './gql/graphql.ts') } },
});
