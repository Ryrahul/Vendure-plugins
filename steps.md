# Plugin Creation Steps

Quick reference for creating a new Vendure plugin in this monorepo.

---

## 1. Scaffold the plugin

```bash
mkdir -p packages/vendure-plugin-<name>/src/{api,services,entities,errors,migrations,strategy}
```

## 2. Create package.json

```json
{
  "name": "@rahul_vendure/vendure-plugin-<name>",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist/**/*"],
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "@vendure/core": "^3.0.0"
  }
}
```

If the plugin has dashboard extensions, add `exports` and include raw TSX:

```json
{
  "exports": {
    "./package.json": "./package.json",
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js" },
    "./dashboard": { "types": "./src/dashboard/index.tsx", "import": "./src/dashboard/index.tsx" }
  },
  "files": ["dist/**/*", "src/dashboard/**/*"]
}
```

## 3. Create tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"],
  "exclude": ["src/dashboard"]
}
```

## 4. Write the plugin code

Typical file structure:

```
src/
├── index.ts                    # Barrel export (public API)
├── <name>.plugin.ts            # Main plugin class with @VendurePlugin
├── constants.ts                # Plugin option symbol, logger context, etc.
├── types.ts                    # Options interface (non-GraphQL types only)
├── generated-graphql-types.ts  # Auto-generated GraphQL types (committed)
├── api/
│   ├── api-extensions.ts       # GraphQL schema (gql tagged template)
│   ├── <name>.resolver.ts      # Mutation/Query resolvers
│   └── union-type.resolvers.ts # Union type __resolveType resolvers
├── errors/
│   └── <name>.errors.ts        # Custom ErrorResult classes
├── services/
│   └── <name>.service.ts       # Business logic
├── entities/                   # TypeORM entities (if needed)
├── migrations/                 # Migration files (if entities exist)
└── strategy/                   # Authentication or other strategies
```

## 5. Key patterns

### Plugin class

```ts
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        { provide: MY_PLUGIN_OPTIONS, useFactory: () => MyPlugin.options },
        MyService,
    ],
    shopApiExtensions: { schema: myApiExtensions, resolvers: [MyResolver] },
    configuration: (config) => {
        // Push custom fields, auth strategies, etc.
        return config;
    },
    compatibility: '^3.0.0',
})
export class MyPlugin {
    static options: MyPluginOptions;
    static init(options: MyPluginOptions): Type<MyPlugin> {
        this.options = { ...defaults, ...options };
        return MyPlugin;
    }
}
```

### Error classes

```ts
export class MyCustomError extends ErrorResult {
    readonly __typename = 'MyCustomError';
    readonly errorCode = 'MY_CUSTOM_ERROR';
    readonly message = 'MY_CUSTOM_ERROR';
}
```

### Union type resolvers

```ts
@Resolver('MyUnionResult')
export class MyUnionResultResolver {
    @ResolveField()
    __resolveType(value: any) {
        return isGraphQlErrorResult(value) ? (value as any).__typename : 'Success';
    }
}
```

### Index.ts barrel export

Only export what consumers need:

```ts
export { MyPlugin } from './my.plugin';
export { MyPluginOptions, SomeInterface } from './types';
export { MyCustomError } from './errors/my.errors';
```

## 6. Set up GraphQL codegen

GraphQL input types and resolver args types are auto-generated per-plugin, not manually defined.

### Add codegen files to the plugin

Copy `vendure-schema-stub.graphql` from an existing plugin (e.g. `vendure-plugin-faq`).

Create `codegen.yml` in the plugin root:

```yaml
schema:
  - 'vendure-schema-stub.graphql'
  - 'src/**/*.ts'
generates:
  ./src/generated-graphql-types.ts:
    plugins:
      - typescript
    config:
      maybeValue: 'T | undefined'
      inputMaybeValue: 'T | undefined'
      scalars:
        DateTime: Date
        Money: number
        LanguageCode: import('@vendure/common/lib/generated-types').LanguageCode
      namingConvention:
        enumValues: keep
      avoidOptionals: false
```

Add devDependencies and scripts to `package.json`:

```json
{
  "scripts": {
    "generate": "graphql-codegen --config codegen.yml",
    "build": "npm run generate && tsc"
  },
  "devDependencies": {
    "@graphql-codegen/cli": "^6.1.1",
    "@graphql-codegen/typescript": "^5.0.8"
  }
}
```

### Generate types

```bash
cd packages/vendure-plugin-<name>
npm run generate    # generates src/generated-graphql-types.ts
```

This also runs automatically on `npm run build`.

### Use generated types

In resolvers, use the generated `Mutation*Args` and `Query*Args` types:

```ts
import { MutationCreateMyEntityArgs, QueryMyEntityArgs } from '../generated-graphql-types';

@Mutation()
async createMyEntity(@Ctx() ctx: RequestContext, @Args() args: MutationCreateMyEntityArgs) {
    return this.myService.create(ctx, args.input);
}
```

In services, use the generated input types:

```ts
import { CreateMyEntityInput, UpdateMyEntityInput } from '../generated-graphql-types';

async create(ctx: RequestContext, input: CreateMyEntityInput) { ... }
```

**Do NOT manually define GraphQL input/args types in `types.ts`.** Only non-GraphQL
config interfaces (e.g. `MyPluginOptions`) belong there.

### When to regenerate

Happens automatically on build. To regenerate manually:

```bash
npm run generate -w packages/vendure-plugin-<name>
```

## 7. Build the plugin

```bash
npm run build -w packages/vendure-plugin-<name>
```

## 8. Wire into dev-server for testing

### Add workspace dependency

In `apps/dev-server/package.json`:

```json
"@rahul_vendure/vendure-plugin-<name>": "*"
```

Then run `npm install` from root to symlink it.

### Add to vendure-config.ts

```ts
import { MyPlugin } from '@rahul_vendure/vendure-plugin-<name>';

plugins: [
    // ...existing plugins
    MyPlugin.init({ /* options */ }),
]
```

## 9. Migrations

Plugins do NOT ship migrations. The consumer generates and runs migrations on their end.

If your plugin introduces custom fields or entities, document it in your README:

```markdown
> **Important:** If your project has `synchronize: false`, you need to generate
> and run a database migration after adding this plugin:
>
> ```bash
> npx vendure migrate
> ```
```

**Versioning rules for schema changes:**
- Entity/custom field changes = minor version bump minimum
- Breaking DB changes = major version bump

## 10. Publishing

```bash
cd packages/vendure-plugin-<name>
npm run build
npm pack                    # verify contents
npm publish --access public # scoped packages need --access public
```

### Pre-publish checklist

- [ ] `dist/` exists with compiled JS + declarations
- [ ] `src/dashboard/` included if plugin has dashboard extensions
- [ ] No `src/entities/`, `src/services/` in published package (only `dist/`)
- [ ] `peerDependencies` set for `@vendure/core`
- [ ] Version bumped appropriately
- [ ] No hardcoded secrets or dev-only code

## 11. Versioning

```
1.0.0 → initial release
1.0.1 → bug fix
1.1.0 → new feature / entity change
2.0.0 → breaking change / breaking migration
```
