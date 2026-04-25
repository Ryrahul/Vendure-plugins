# Vendure Plugin Ecosystem

A monorepo of independently publishable [Vendure](https://www.vendure.io/) plugins, maintained by Rahul Yadav.

## Plugins

| Package | Version | Description |
|---------|---------|-------------|
| [`@rahul_vendure/vendure-meilli-search`](./packages/vendure-meilli-search) | 1.0.1 | Drop-in Meilisearch replacement for Vendure's DefaultSearchPlugin. Full-text, faceted, and AI-powered hybrid/semantic search with automatic index syncing. |
| [`@rahul_vendure/vendure-plugin-extra-promotions`](./packages/vendure-plugin-extra-promotions) | 1.1.0 | 9 extra promotion conditions and 5 actions (collection discounts, cross-sell, happy hours, stock clearance, and more). Includes a dashboard UI. |
| [`@rahul_vendure/vendure-plugin-faq`](./packages/vendure-plugin-faq) | 1.0.7 | FAQ management with i18n translations, multi-channel support, Admin + Shop API extensions, and a dashboard panel. |
| [`@rahul_vendure/vendure-plugin-phone-auth`](./packages/vendure-plugin-phone-auth) | 1.0.5 | Phone number + OTP authentication for the Shop API. Pluggable SMS providers, phone validation via `libphonenumber-js`, configurable OTP settings. |
| [`@rahul_vendure/vendure-plugin-wishlist`](./packages/vendure-plugin-wishlist) | 1.0.1 | Customer wishlist functionality with add/remove/bulk operations and variant-level wishlist status resolution. |

All plugins above target `@vendure/core ^3.0.0` as a peer dependency and are licensed under MIT.

### Vendure AI (submodule)

The AI chat packages live in a separate repository and are included here as a [Git submodule](./packages/vendure-ai).

| Package | Description |
|---------|-------------|
| [`@rahul_vendure/ai-chat-plugin`](./packages/vendure-ai/packages/ai-chat-plugin) | AI-powered shopping assistant plugin for Vendure — LLM chat with 19 built-in tools, pgvector semantic search, cart management, order tracking, checkout assistance, and an admin dashboard chat. Requires PostgreSQL with pgvector and an OpenAI API key. |
| [`@rahul_vendure/ai-chat-react`](./packages/vendure-ai/packages/ai-chat-react) | Drop-in AI shopping assistant React component for Vendure stores. Renders a floating chat panel with product cards, collection badges, cart summary, and quick actions. Ships pre-compiled CSS, supports dark mode, and works with Next.js, Remix, Vite, CRA, etc. Pairs with `@rahul_vendure/ai-chat-plugin`. |
| [`@rahul_vendure/ai-chat-dashboard`](./packages/vendure-ai/packages/ai-chat-dashboard) | Admin dashboard extension for the AI chat plugin. |

To clone this repo with the submodule included:

```bash
git clone --recurse-submodules https://github.com/Ryrahul/Vendure-plugins.git
```

Or if already cloned:

```bash
git submodule update --init --recursive
```

## Repository Structure

```
/
├── packages/                     # Publishable plugins
│   ├── vendure-meilli-search/
│   ├── vendure-plugin-extra-promotions/
│   ├── vendure-plugin-faq/
│   ├── vendure-plugin-phone-auth/
│   ├── vendure-plugin-wishlist/
│   └── vendure-ai/               # Git submodule (AI chat packages)
│       ├── packages/
│       │   ├── ai-chat-plugin/
│       │   ├── ai-chat-react/
│       │   └── ai-chat-dashboard/
│       └── apps/
├── apps/
│   └── dev-server/               # Local Vendure instance for testing
├── tsconfig.base.json            # Shared TypeScript config
└── package.json                  # Workspace root
```

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9 (workspaces support)
- **PostgreSQL** (for the dev server)
- **Meilisearch** (only if testing the meilli-search plugin)

## Getting Started

```bash
# Clone the repo (--recurse-submodules pulls in the vendure-ai submodule)
git clone --recurse-submodules https://github.com/Ryrahul/Vendure-plugins.git
cd vendure-packages

# Install all dependencies (workspaces are linked automatically)
npm install

# Build a specific plugin
npm run build -w packages/vendure-plugin-faq

# Start the dev server (runs server, worker, and dashboard concurrently)
cp apps/dev-server/.env.example apps/dev-server/.env  # configure DB credentials
npm run dev -w apps/dev-server
```

## Development

### Dev Server

`apps/dev-server` is a full Vendure instance with all plugins wired in. It uses PostgreSQL and includes mock data for testing. The dev server is **never published**; it exists solely for local development.

```bash
# Start everything (server + worker + dashboard)
npm run dev -w apps/dev-server

# Populate test data
npm run populate -w apps/dev-server
```

Dashboard extensions are automatically discovered from any plugin that has a `src/dashboard/index.tsx` via a custom Vite plugin in `apps/dev-server/vite.config.mts`. No manual registration is needed.

### Building Plugins

Each plugin compiles its backend code to `dist/`. Dashboard extensions (if present) are published as raw TSX and bundled by the consuming project's Vite build.

```bash
# Build a single plugin
npm run build -w packages/vendure-plugin-<name>

# Watch mode
npm run watch -w packages/vendure-plugin-<name>
```

### GraphQL Codegen

Plugins that extend the GraphQL API use per-plugin `@graphql-codegen` to generate typed inputs and args. Types are regenerated automatically during `npm run build`, or manually:

```bash
npm run generate -w packages/vendure-plugin-<name>
```

Generated types are committed to git. Do **not** manually define GraphQL input/args types -- import them from `generated-graphql-types.ts` instead.

## Contributing

### Adding a New Plugin

1. **Scaffold** the plugin directory:

   ```bash
   mkdir -p packages/vendure-plugin-<name>/src/{api,services,entities,errors,strategy}
   ```

2. **Create `package.json`** with the `@rahul_vendure/` scope, `@vendure/core ^3.0.0` as a peer dependency, and the standard build scripts. See any existing plugin for a template.

3. **Create `tsconfig.json`** extending `../../tsconfig.base.json` with `outDir: "dist"` and `rootDir: "src"`. Exclude `src/dashboard` if the plugin has a dashboard extension.

4. **Write the plugin** following the standard file layout:

   ```
   src/
   ├── index.ts              # Barrel export (public API only)
   ├── <name>.plugin.ts      # @VendurePlugin class
   ├── constants.ts           # Injection tokens, logger context
   ├── types.ts               # Non-GraphQL config interfaces
   ├── api/
   │   ├── api-extensions.ts  # GraphQL schema extensions
   │   └── *.resolver.ts
   ├── services/
   ├── entities/
   └── errors/
   ```

5. **Set up GraphQL codegen** if the plugin extends the API. Copy `vendure-schema-stub.graphql` and `codegen.yml` from an existing plugin and add the codegen dev dependencies.

6. **Wire into the dev server** by adding the dependency to `apps/dev-server/package.json` and importing the plugin in `vendure-config.ts`.

7. If the plugin includes a **dashboard extension**, ensure `src/dashboard/index.tsx` exists and add a root-level `index.ts` that re-exports from `./src/index`.

### Code Guidelines

- Plugins do **not** ship migrations. Document any schema changes in the plugin's README so consumers know to run `npx vendure migrate`.
- Only `dist/` and `src/dashboard/` are published. Never publish raw backend source.
- Follow [semantic versioning](https://semver.org/): patch for bug fixes, minor for new features or entity changes, major for breaking changes.

### Publishing

```bash
cd packages/vendure-plugin-<name>
npm run build
npm pack          # inspect the tarball contents
npm publish --access public
```

Verify before publishing:
- `dist/` contains compiled JS and `.d.ts` files
- `src/dashboard/` is included if the plugin has a dashboard
- No `src/entities/`, `src/services/`, etc. leak into the package
- Version is bumped appropriately

## License

MIT
