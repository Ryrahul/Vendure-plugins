# @rahul_vendure/vendure-plugin-channel-product-availability

Per-channel product availability for [Vendure](https://vendure.io). Enable a product in one channel and disable it in another, without touching the global `Product.enabled` flag. The rule is enforced in catalog queries, search, cart and checkout.

| Store | Global `Product.enabled` | Override | Customers there… |
|---|---|---|---|
| Nepal | `true` | — | can find and buy it |
| India | `true` | `false` | cannot find or buy it |
| UK | `false` | `true` | can find and buy it |

- **Explicit overrides always win.** No override means the global flag applies, exactly as in unmodified Vendure.
- **Overrides are sparse.** No rows are created up front and nothing is back-filled.
- **Native rules still apply.** An override never assigns a product to a channel and never bypasses variant `enabled`, stock, prices or channel membership.
- **Standalone.** No other custom plugin is needed, and Vendure core is not modified.

## Install

```bash
npm install @rahul_vendure/vendure-plugin-channel-product-availability
```

```ts
import { ChannelProductAvailabilityPlugin } from '@rahul_vendure/vendure-plugin-channel-product-availability';

export const config: VendureConfig = {
    plugins: [
        DefaultSearchPlugin.init({}),
        ChannelProductAvailabilityPlugin.init({}),
    ],
};
```

### Database migration

The plugin adds one table, `product_channel_availability`. If your project uses `synchronize: false`, pick **one** of the following:

```ts
// a) use the migration that ships with the plugin (works on Postgres, MySQL/MariaDB and SQLite,
//    and with integer or UUID ids)
import { ChannelProductAvailabilityMigration1792195200000 } from '@rahul_vendure/vendure-plugin-channel-product-availability';
dbConnectionOptions: { migrations: [ChannelProductAvailabilityMigration1792195200000, /* yours */] }
```

```bash
# b) generate your own
npx vendure migrate
```

| Column | Notes |
|---|---|
| `id`, `createdAt`, `updatedAt` | standard Vendure entity columns |
| `productId` | FK → `product.id`, `ON DELETE CASCADE` |
| `channelId` | FK → `channel.id`, `ON DELETE CASCADE` |
| `enabled` | the override value |

Indexes: `UNIQUE (productId, channelId)` and `(channelId, enabled)`.

### Dashboard

The React Dashboard extension is discovered automatically through the plugin's `dashboard` metadata. It adds a **Channel availability** block to the product detail page. For each channel the product is assigned to, the block shows:

- whether the product is available there
- whether that comes from the global flag or from an override
- buttons to enable, disable, or go back to the global flag (**Use global**)

The block also warns when a product is disabled globally but explicitly enabled somewhere. Channels where the admin can't update show as read-only.

The backend works without the Dashboard.

## Options

All options default to `true`.

| Option | Effect when `true` |
|---|---|
| `enforceCatalog` | Shop API `products`, `product` and `Collection.productVariants` follow the channel rule |
| `enableOverridePurchasing` | Products that are globally disabled but enabled in the channel can be added to carts (shop) and draft orders (admin) |
| `syncDefaultSearchIndex` | Keeps the DefaultSearchPlugin index in sync with overrides |
| `validateOnCheckout` | Blocks `ArrangingPayment` while the cart contains a product explicitly disabled in that channel |

Explicitly disabled products are always rejected when adding to a cart, whatever the options say.

## Admin API

```graphql
query {
  productChannelAvailability(productId: "1", channelId: "2") {   # channelId defaults to the active channel
    channelCode globalEnabled override overrideState effectiveEnabled productInChannel
  }
  productChannelAvailabilities(productId: "1") { channelCode overrideState effectiveEnabled }
  productChannelAvailabilityOverrides(options: { channelId: "2", enabled: false }) {
    items { productId enabled } totalItems
  }
}

mutation {
  setProductChannelAvailability(input: { productId: "1", channelId: "2", enabled: true }) { effectiveEnabled }
  clearProductChannelAvailability(input: { productId: "1", channelId: "2" }) { overrideState }   # → INHERITED
}
```

**Permissions.** Reads need `ReadCatalog` or `ReadProduct`; writes need `UpdateCatalog` or `UpdateProduct`. The check is made in the **target** channel, not only the active one, so an admin of channel A can't change channel B by passing its `channelId`.

**Validation.** Setting an override on a product that isn't assigned to the channel fails with a clear error. The plugin never assigns products to channels.

## Using the service

`ChannelProductAvailabilityService` is the single source of truth for the rule, and it's exported for your own code:

```ts
constructor(private availability: ChannelProductAvailabilityService) {}

await this.availability.isEnabled(ctx, productId);              // active channel
await this.availability.getAvailability(ctx, productId);        // full detail
await this.availability.getAvailabilityForChannel(ctx, productId, channelId);
await this.availability.getOverrides(ctx, productIds);          // batched, Map<productId, boolean>
await this.availability.setOverride(ctx, productId, true, channelId);
await this.availability.clearOverride(ctx, productId, channelId);
await this.availability.getEffectiveEnabledProductFilter(ctx);  // ListQueryBuilder filter for custom queries
```

Behaviour:

- Writes run in the caller's transaction and are idempotent: writing the current value is a no-op.
- Concurrent writers can't create duplicate rows; the unique key plus an upsert prevents it.
- Reads are batched and cached for the rest of the request.

### Events

The plugin publishes `ProductChannelAvailabilityEvent` after the transaction commits. Its `type` is one of:

| Type | When |
|---|---|
| `set` | an override was created or changed |
| `cleared` | an override was removed (the product inherits the global flag again) |
| `removed` | an override was cleaned up because the product was deleted, the product was removed from the channel, or the channel was deleted |
| `global-changed` | `Product.enabled` changed; `channelId` is `null` |

## Search integration contract

**DefaultSearchPlugin** is supported out of the box. Its index has one row per (variant, channel, language), and the plugin keeps the `enabled` column correct in two ways:

- when you change an override, it patches the existing rows immediately in the same transaction
- whenever the indexer writes rows, it corrects them as they're written

As a result, results, `totalItems`, pagination and facet counts are all correct.

**Other search plugins** (Elasticsearch, Meilisearch, Typesense, etc.) need to do three things:

1. Index availability **per channel**. For a variant in channel C:
   ```ts
   const overrides = await availabilityService.getOverrides(ctx /* channel C */, productIds);
   const productEnabled = resolveEffectiveEnabled(product.enabled, overrides.get(String(product.id)));
   const indexedEnabled = productEnabled && variant.enabled;
   ```
2. Reindex `productId` when `ProductChannelAvailabilityEvent` fires. Reindex it in `channelId`, or in every channel when `channelId` is `null`.
3. Filter on the indexed per-channel flag **in the search engine query**. Filtering results after pagination gives wrong counts.

## Limitations

- **Guest-cart merge at login.** Vendure's `OrderService.mergeOrders` calls core `addItemsToOrder` directly, and plugins can't override that. Suppose a customer adds a product that is *globally disabled but enabled in this channel* to a guest cart, then logs in while they already have an active cart. Core's merge rejects that line, the same way core treats any globally disabled product. Products that are globally enabled are not affected.
- **Changes during payment.** A product disabled *after* the order reached `ArrangingPayment` is not blocked at payment time; core does the same for globally disabled products.
- **Admin `modifyOrder`.** Core doesn't check `enabled` when an admin modifies a placed order, and the plugin keeps that behaviour.
- **Resolver overrides.** The plugin overrides these Shop API resolvers, using the override mechanism documented by Vendure: `products`, `product`, `Collection.productVariants`, `addItemToOrder` and `addItemsToOrder`. It also overrides the Admin API `addItemToDraftOrder`. Another plugin overriding the same fields would conflict. In that case, turn off `enforceCatalog` and/or `enableOverridePurchasing` and call `ChannelProductAvailabilityService` from your own resolver.
- **Large override sets.** Product lists filter with `id IN (...)` on the overridden ids for the channel, which is fine for thousands of overrides per channel. Overrides are meant to be exceptions, not the norm.
- **Interceptors called twice.** When an override-enabled product (globally disabled) is added, third-party `OrderInterceptor`s receive both `willAddItemToOrder` and `willAdjustOrderLine`.

## Compatibility

| Vendure | Database | Status |
|---|---|---|
| 3.8.0 | Postgres 14+ | ✅ 66/66 tests pass |
| 3.8.0 | SQLite (sql.js) | ✅ 66/66 tests pass |
| 3.6.1 | Postgres 14+ | ✅ 66/66 tests pass |
| 3.6.1 | SQLite (sql.js) | ✅ 66/66 tests pass |
| 3.7.x | — | expected to work, not tested |
| MySQL / MariaDB | — | migration is database-agnostic; not tested |

Peer dependency: `@vendure/core ^3.6.0`. Run the suite against any release with `./scripts/test-against-vendure.sh <version>`.

## Development

```bash
npm run build                 # codegen + compile to dist/
npm test                      # unit + e2e (sql.js)
npm run test:e2e:postgres     # e2e on a real Postgres (PGHOST/PGUSER/PGPASSWORD)
./scripts/test-against-vendure.sh 3.8.0
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for every core code path involved and the extension point used for each.

## License

MIT
