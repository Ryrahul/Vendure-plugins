import { vendureDashboardPlugin } from '@vendure/dashboard/vite';
import { readdirSync, existsSync, lstatSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { defineConfig, Plugin } from 'vite';

/**
 * Workaround for Vendure dashboard plugin discovery not scanning symlinked
 * workspace packages. The built-in discovery excludes symlinked packages
 * from its JS glob patterns, so their `dashboard` metadata is never found.
 *
 * This plugin dynamically discovers ALL workspace packages under `packages/`
 * that contain a `src/dashboard/index.tsx` entry point and injects them into
 * the `virtual:dashboard-extensions` module at build/serve time.
 *
 * Adding a new plugin with a dashboard? Just put `src/dashboard/index.tsx`
 * in your package — it will be picked up automatically.
 */
function workspaceDashboardExtensions(): Plugin {
    // Must match @vendure/dashboard's vite-plugin-dashboard-metadata.js:
    // virtualModuleId = 'virtual:dashboard-extensions', resolved = '\0' + virtualModuleId
    const resolvedId = `\0virtual:dashboard-extensions`;
    const packagesDir = resolve(__dirname, '../../packages');

    function discoverDashboardExtensions(): string[] {
        const extensions: string[] = [];
        if (!existsSync(packagesDir)) return extensions;

        for (const entry of readdirSync(packagesDir)) {
            const pkgDir = join(packagesDir, entry);
            // Only look at directories (skip files)
            try {
                if (!lstatSync(pkgDir).isDirectory()) continue;
            } catch {
                continue;
            }
            const dashboardEntry = join(pkgDir, 'src/dashboard/index.tsx');
            if (existsSync(dashboardEntry)) {
                extensions.push(dashboardEntry);
            }
        }
        return extensions;
    }

    return {
        name: 'vendure:workspace-dashboard-extensions',
        enforce: 'post',
        transform(code, id) {
            if (id === resolvedId) {
                const extensions = discoverDashboardExtensions();
                const imports = extensions
                    .map(ext => `await import('${pathToFileURL(ext).href}');`)
                    .join('\n');
                return {
                    code: `
export async function runDashboardExtensions() {
    ${imports}
}
`,
                    map: null,
                };
            }
        },
    };
}

export default defineConfig({
    base: '/dashboard',
    build: {
        outDir: join(__dirname, 'dist/dashboard'),
    },
    plugins: [
        vendureDashboardPlugin({
            vendureConfigPath: pathToFileURL('./src/vendure-config.ts'),
            api: { host: 'http://localhost', port: 3000 },
            gqlOutputPath: './src/gql',
        }),
        workspaceDashboardExtensions(),
    ],
    resolve: {
        alias: {
            '@/gql': resolve(__dirname, './src/gql/graphql.ts'),
        },
    },
});
