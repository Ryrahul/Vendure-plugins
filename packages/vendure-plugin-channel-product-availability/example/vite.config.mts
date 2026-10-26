// Builds the Vendure dashboard with this plugin's extension, for the example app.
//
// In a normal project no extra config is needed: vendureDashboardPlugin discovers the plugin's
// `dashboard` entry from the Vendure config. This example imports the plugin from '../src'
// (outside the config's folder), which discovery doesn't follow, so the extension is added
// explicitly, as the monorepo's dev-server does for workspace packages.
import { vendureDashboardPlugin } from '@vendure/dashboard/vite';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { defineConfig, Plugin } from 'vite';

function availabilityDashboardExtension(): Plugin {
    const resolvedId = '\0virtual:dashboard-extensions';
    const entry = pathToFileURL(resolve(__dirname, '../src/dashboard/index.tsx')).href;
    return {
        name: 'example:channel-availability-dashboard-extension',
        enforce: 'post',
        transform(code, id) {
            if (id === resolvedId) {
                return { code: `export async function runDashboardExtensions() { await import('${entry}'); }`, map: null };
            }
        },
    };
}

/** Lets Tailwind scan the extension's classes (discovery would add this @source). */
function availabilityTailwindSource(): Plugin {
    return {
        name: 'example:channel-availability-tailwind-source',
        enforce: 'pre',
        transform(code, id) {
            if (id.split('?')[0].endsWith('/src/app/styles.css') && code.includes('@source rules from extensions')) {
                return { code: `${code}\n@source '${resolve(__dirname, '../src/dashboard')}';\n`, map: null };
            }
        },
    };
}

export default defineConfig({
    base: '/dashboard',
    build: { outDir: join(__dirname, 'dist/dashboard') },
    plugins: [
        // before vendureDashboardPlugin, whose Tailwind plugin compiles the stylesheet
        availabilityTailwindSource(),
        vendureDashboardPlugin({
            vendureConfigPath: pathToFileURL('./vendure-config.ts'),
            api: { host: 'http://localhost', port: 3093 },
            gqlOutputPath: './gql',
            // The config imports '../src'; compile it here so that path stays inside this package.
            tempCompilationDir: join(__dirname, '.dashboard-tmp/config'),
        }),
        availabilityDashboardExtension(),
    ],
    resolve: { alias: { '@/gql': resolve(__dirname, './gql/graphql.ts') } },
});
