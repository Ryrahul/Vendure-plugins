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
  "name": "@rahul/vendure-plugin-<name>",
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
├── types.ts                    # Options interface, custom types
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

## 6. Build the plugin

```bash
npm run build -w packages/vendure-plugin-<name>
```

## 7. Wire into dev-server for testing

### Add workspace dependency

In `apps/dev-server/package.json`:

```json
"@rahul/vendure-plugin-<name>": "*"
```

Then run `npm install` from root to symlink it.

### Add to vendure-config.ts

```ts
import { MyPlugin } from '@rahul/vendure-plugin-<name>';

plugins: [
    // ...existing plugins
    MyPlugin.init({ /* options */ }),
]
```

## 8. If the plugin has entities (needs migrations)

1. Start dev-server with `synchronize: true` first to let tables create
2. Then generate migration:
   ```bash
   npx vendure migrate -w apps/dev-server
   ```
3. Move the generated file to `packages/vendure-plugin-<name>/src/migrations/`
4. Reference in plugin:
   ```ts
   config.dbConnectionOptions.migrations?.push(
       ...glob.sync(path.join(__dirname, 'migrations/*.js'))
   );
   ```
5. Set `synchronize: false` and run migrations going forward
6. Always reference `.js` in production, never `.ts`
7. Entity changes = minor version bump minimum
8. Breaking DB changes = major version bump

## 9. Publishing

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

## 10. Versioning

```
1.0.0 → initial release
1.0.1 → bug fix
1.1.0 → new feature / entity change
2.0.0 → breaking change / breaking migration
```
