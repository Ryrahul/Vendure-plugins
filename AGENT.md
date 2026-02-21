# AGENT.md
Project: Rahul Vendure Plugin Ecosystem
Owner: Rahul Yadav

This repository is a monorepo containing multiple independently
publishable Vendure plugins and a local development server used
for testing those plugins.

This document defines the architectural contract that the AI
assistant must follow when generating, modifying, or restructuring code.

============================================================
1. MONOREPO STRUCTURE
============================================================

Root structure:

/
├── packages/
│   ├── <plugin-name>/
│   │    ├── src/
│   │    │    ├── entities/
│   │    │    ├── services/
│   │    │    ├── resolvers/
│   │    │    ├── subscribers/
│   │    │    ├── migrations/
│   │    │    ├── gql/
│   │    │    │    └── generated.ts    (auto-generated, gitignored)
│   │    │    ├── dashboard/          (React Dashboard extension)
│   │    │    │    ├── index.tsx
│   │    │    │    ├── routes.tsx
│   │    │    │    └── components/
│   │    │    └── index.ts
│   │    │
│   │    ├── dist/                    (compiled backend only)
│   │    ├── package.json
│   │    ├── tsconfig.json
│   │    └── README.md
│   │
│   └── <another-plugin>/
│
├── apps/
│   └── dev-server/
│        ├── src/
│        │    └── vendure-config.ts
│        ├── codegen.ts               (GraphQL codegen config)
│        ├── schema.graphql           (auto-generated, gitignored)
│        ├── package.json
│        └── tsconfig.json
│
├── tsconfig.base.json
├── package.json (workspace root)
└── AGENT.md


============================================================
2. WORKSPACES RULES
============================================================

Root package.json must contain:

{
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ]
}

Rules:

- Root is NEVER published.
- Each plugin is independently publishable.
- Dev server is private.
- Cross-package imports must use package name.

GOOD:
import { X } from '@rahul/vendure-plugin-stripe'

BAD:
import { X } from '../../stripe'

Relative imports across packages are forbidden.

============================================================
3. PLUGIN PACKAGE RULES
============================================================

Each plugin inside /packages must:

- Be independently versioned.
- Use semantic versioning.
- Use peerDependencies for Vendure.
- Publish compiled backend (dist).
- Publish raw dashboard TSX (if exists).

Minimal package.json (Backend Only):

{
  "name": "@rahul/vendure-plugin-<name>",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist/**/*"],
  "peerDependencies": {
    "@vendure/core": "^2.0.0"
  },
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "prepublishOnly": "npm run build"
  }
}

============================================================
4. DASHBOARD (React Admin Dashboard Extension) RULES
============================================================

Vendure uses Vite to bundle dashboard extensions
inside the host project.

IMPORTANT:

- Raw .ts/.tsx files MUST be published.
- Dashboard files must NOT be pre-bundled.
- Backend must still be compiled to dist.

Correct package.json configuration for plugins with dashboard:

{
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./dashboard": {
      "types": "./src/dashboard/index.tsx",
      "import": "./src/dashboard/index.tsx",
      "default": "./src/dashboard/index.tsx"
    }
  },
  "files": [
    "dist/**/*",
    "src/dashboard/**/*"
  ]
}

Rules:

- Only src/dashboard is allowed to be published raw.
- Do NOT publish src/entities or src/services.
- Dashboard code must live inside src/dashboard.
- Backend and dashboard logic must be separated.

============================================================
5. TYPESCRIPT RULES
============================================================

Root tsconfig.base.json:

{
  "compilerOptions": {
    "target": "ES2019",
    "module": "commonjs",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true
  }
}

Each plugin tsconfig.json:

{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "composite": true
  },
  "include": ["src"],
  "exclude": ["src/dashboard"]
}

Dashboard files are NOT compiled for publishing.
They are bundled by host Vite.

============================================================
6. GRAPHQL CODEGEN RULES
============================================================

GraphQL input types, args types, and query/mutation types
are auto-generated from the schema using @graphql-codegen.

Infrastructure lives in apps/dev-server:

- codegen.ts        → codegen configuration
- schema.graphql    → generated schema file (gitignored)

Generated output goes into each plugin:

- packages/<plugin>/src/gql/generated.ts (gitignored)

Workflow:

1. cd apps/dev-server
2. npm run schema       → generates schema.graphql from Vendure config
3. npm run codegen      → generates TypeScript types into plugin src/gql/

When to regenerate:

- After adding/changing GraphQL schema extensions (api-extensions.ts)
- After adding/changing custom fields
- After updating Vendure version

Rules:

- NEVER manually define GraphQL input/args types in plugin code.
  Import them from '../gql/generated' instead.
- Plugin-specific config interfaces (e.g. FaqPluginOptions) that are
  NOT part of the GraphQL schema should still live in types.ts.
- schema.graphql and generated.ts are gitignored. Each developer
  must regenerate locally after cloning.
- The codegen config uses maybeValue: 'T | undefined' to match
  Vendure core's convention (not T | null).
- When adding a new plugin to codegen, add an entry in
  apps/dev-server/codegen.ts under the generates section.

Adding a new plugin to codegen:

In apps/dev-server/codegen.ts, add:

generates: {
    '../../packages/vendure-plugin-<name>/src/gql/generated.ts': {
        plugins: ['typescript'],
    },
}

============================================================
7. MIGRATION RULES
============================================================

Plugins do NOT ship migrations.
Migrations are the consumer's responsibility.

If a plugin introduces custom fields or entities, the consumer
must generate and run migrations on their end:

npx vendure migrate

The plugin README must document any schema changes clearly
so consumers know to run migrations.

When schema changes:
- Minor version bump minimum.
- Breaking DB change → major bump.

============================================================
8. DEV SERVER RULES
============================================================

apps/dev-server is used ONLY for local testing.

It must:

- Import plugins using workspace "*"
- Not contain plugin-specific logic
- Be able to:
  - run vendure dev
  - generate migrations
  - run migrations

Example dependency:

"@rahul/vendure-plugin-stripe": "*"

Dev server must never be published.

============================================================
9. PUBLISHING WORKFLOW
============================================================

Before publishing any plugin:

1. Run build
2. Run npm pack
3. Verify package contents
4. Ensure:
   - dist exists
   - dashboard TSX exists (if applicable)
5. Publish:

npm publish --access public

Scoped packages require --access public.

Never publish raw src except src/dashboard.

============================================================
10. VERSIONING STRATEGY
============================================================

1.0.0 → initial
1.0.1 → bug fix
1.1.0 → new feature
2.0.0 → breaking change

If entity changes → at least minor.
If migration is breaking → major.

============================================================
11. AI ASSISTANT BEHAVIOR CONTRACT
============================================================

When generating plugin code:

- Follow folder structure exactly.
- Separate backend and dashboard clearly.
- Generate production-grade TypeScript.
- Never use cross-package relative imports.
- If entities exist → mention migration requirement.
- If dashboard exists → include exports config.
- Respect publishing rules.
- Do not introduce unnecessary dependencies.

When modifying code:

- Do not break npm packaging.
- Do not move dashboard outside src/dashboard.
- Do not publish backend source.
- Maintain semantic version awareness.

The assistant may:

- Scaffold full plugin.
- Generate migration templates.
- Refactor plugin into publish-ready structure.
- Create dashboard extensions.
- Suggest version bump.
- Optimize build configuration.

============================================================
END OF ARCHITECTURAL CONTRACT
============================================================