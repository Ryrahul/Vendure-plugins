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

The React Dashboard extension is discovered automatically through the plugin's `dashboard` metadata. It adds a **Channel availability** block to the product detail page:

- a **Global / On / Off** control per channel. *Global* follows the product's own Enabled switch; *On* and *Off* override it for that channel only.
- an "Available in X of Y channels" summary and a callout when the global switch and a channel disagree (e.g. "Disabled globally, but still sold in UK")
- changes apply instantly and roll back if the server rejects them
- channels where the admin has read but not update permission are shown as **view only**; channels the admin can't read at all are not listed

It also adds:

- a **bulk action** in the product list: select products, choose **Availability in channels…**, then pick the channels and *On*, *Off* or *Global*. The result shows how many pairs changed, were already set, or were skipped (with the reason, e.g. "not assigned to channel").
- a **Catalog → Channel availability** page listing the overrides of a chosen channel, with a product name search, an On/Off filter, paging, and a "Use global" button per row.

Rendered and click-tested in light and dark themes on Vendure 3.6 and 3.8 (`@vendure-io/ui` 1.x and 2.x). On 3.8 it was checked as a consumer would use it: the package installed from its tarball and the dashboard built with the standard `vendureDashboardPlugin`, with no extra dependencies. The backend works without the Dashboard.

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

**Bulk changes.** For many products in many channels at once, in one transaction:

```graphql
mutation {
  setProductChannelAvailabilities(input: { productIds: ["1", "2", "3"], channelIds: ["2", "5"], enabled: false }) {
    updated        # overrides created or changed
    unchanged      # already had that value
    skipped { productId channelId reason }   # e.g. the product isn't assigned to that channel
  }
  clearProductChannelAvailabilities(input: { productIds: ["1"], channelIds: ["2", "5"] }) { updated unchanged }
}
```

- Partial success: pairs that can't be applied are reported in `skipped`, the rest still apply.
- Permission is required in **every** listed channel, otherwise the whole call is refused. An unknown channel id is refused the same way.
- At most 1,000 product × channel pairs per call.
- One `ProductChannelAvailabilityEvent` per changed pair.

**Listing a channel.** `productChannelAvailabilityOverrides` accepts `productName` (case-insensitive "contains") and returns each override's `productName` and `productEnabled` (the global flag).

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
await this.availability.getEffectiveEnabledProductFilter(ctx);  // ListQueryBuilder filter for Product lists
await this.availability.setOverrides(ctx, productIds, channelIds, false);   // bulk, see below
await this.availability.clearOverrides(ctx, productIds, channelIds);
```

### Custom queries

Shop queries that load products or variants from the database themselves (QueryBuilder, ListQueryBuilder, raw SQL, cached id lists) bypass the plugin's resolvers. One call makes them follow the rule:

`available(product, channel) = override(product, channel) ?? product.enabled`

The helpers also drop deleted products and, for variants, disabled or deleted variants, so they replace the usual `enabled` / `deletedAt` checks. They use the active channel unless you pass a `channelId`. Channel membership stays your query's job: no channel joins are added.

```ts
// A cached id list (e.g. in Redis): filter on every request, then page.
// Keeps the input order; one query per 5,000 ids.
const ids = await availability.filterAvailableVariantIds(ctx, cachedVariantIds);
const page = ids.slice(skip, skip + take);   // totalItems = ids.length
await availability.filterAvailableProductIds(ctx, cachedProductIds);

// A QueryBuilder that joined the product: adds `product.id IN (<available products>)`.
const qb = connection.getRepository(ctx, ProductVariant).createQueryBuilder('variant')
    .innerJoin('variant.product', 'product')
    .where('variant.enabled = :enabled AND variant.deletedAt IS NULL', { enabled: true });
await availability.applyToQueryBuilder(ctx, qb, 'product');

// A ProductVariant query, e.g. from ListQueryBuilder: also requires enabled, non-deleted variants.
const listQb = listQueryBuilder.build(ProductVariant, options, { ctx, channelId: ctx.channelId });
await availability.applyToVariantQueryBuilder(ctx, listQb, listQb.alias);
const [items, totalItems] = await listQb.getManyAndCount();

// A ListQueryBuilder *filter* for ProductVariant lists, combined with the caller's filter.
const guard = await availability.getEffectiveEnabledVariantFilter(ctx);
productVariantService.findAll(ctx, enforceGuardFilter(args.options, guard));

// Raw SQL: a subquery with named parameters.
const { sql, params } = await availability.getAvailableProductIdsSubQuery(ctx);
qb.andWhere(`variant.productId IN (${sql})`, params);
// or: const [query, values] = connection.rawConnection.driver.escapeQueryWithParameters(sql, params, {});
```

Notes:

- **The QueryBuilder helpers use a subquery on the override table**, not inlined id lists. So they never produce `IN ()`, stay fast with many overrides, and use unique aliases and parameter names: you can call them twice on one query.
- Table and column names come from the entity metadata, so `entityPrefix` and naming strategies are respected.
- `getEffectiveEnabledVariantFilter` lists the products that are effectively disabled in the channel (`productId notIn [...]`). That's normally a short list; if many products are disabled, prefer `applyToVariantQueryBuilder`.
- `enforceGuardFilter` (exported) ANDs a guard with the caller's filter, even when the caller uses `filterOperator: OR`.

### Behaviour

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

### Elasticsearch

[`@vendure-community/elasticsearch-plugin`](https://www.npmjs.com/package/@vendure-community/elasticsearch-plugin) (1.1.0 and 2.0.0) is supported through a separate entry point, so projects without Elasticsearch never load it:

```ts
import { ElasticsearchPlugin } from '@vendure-community/elasticsearch-plugin';
import { ChannelProductAvailabilityPlugin } from '@rahul_vendure/vendure-plugin-channel-product-availability';
import {
    ChannelAvailabilityElasticsearchPlugin,
    withChannelAvailability,
} from '@rahul_vendure/vendure-plugin-channel-product-availability/elasticsearch';

plugins: [
    ElasticsearchPlugin.init(
        withChannelAvailability({
            host: 'http://localhost', port: 9200,   // ES plugin 1.x; 2.x: adapter: () => createElasticsearchAdapter({ host, port })
            searchConfig: { mapQuery: (query, input) => { /* your existing logic */ return query; } },
        }),
    ),
    ChannelProductAvailabilityPlugin.init({ syncDefaultSearchIndex: false }),
    ChannelAvailabilityElasticsearchPlugin,
]
```

Then **run a full reindex** (the `reindex` mutation), so every document gets the new field.

What it does:

- **Indexes availability per channel.** Each variant document gets `variant-channelEnabled`, the variant's availability in that document's channel. It's not exposed in the GraphQL API.
- **Filters on it in the Shop API.** `withChannelAvailability` swaps the indexer's `{ term: { enabled: true } }` for the channel-aware field, inside `bool.filter`, so relevance scores don't change. It runs before your own `mapQuery`, so the swap also happens for searches your `mapQuery` returns early from (browse-by-collection, facets). Results, `totalItems`, facet counts and `groupByProduct` searches are all filtered in Elasticsearch.
- **Rollout fallback.** Documents indexed before the field existed keep matching on `enabled` until they're reindexed, so search never empties out after a deploy.
- **Reindexes on change.** `ChannelAvailabilityElasticsearchPlugin` reindexes a product when an override is set or cleared; the Elasticsearch plugin already handles the other causes. This goes through the job queue, so search reflects a change once the worker has run the job. Several changes to the same product within a short time (e.g. a bulk change across channels) cause one reindex.
- **Admin API searches are unchanged:** they return everything.

If you'd rather wire it by hand, the pieces are exported: `channelEnabledVariantMapping` (under `customProductVariantMappings.channelEnabled`), `channelEnabledIndexMapping` (for `indexMappingProperties`), and `applyChannelAvailabilityFilter(query, enabledOnly)`. Call the filter first thing in `mapQuery`.

Requirements of the Elasticsearch plugin itself, not of this adapter:

- **Server version:** both ES plugin versions use the Elasticsearch **9.x** client, which an 8.x server rejects (`media_type_header_exception`). Use an Elasticsearch 9 server.
- **Vendure 3.8:** the ES plugin imports `@nestjs/terminus`, which Vendure 3.8 no longer ships. Install it in the project; next to Vendure 3.8 that needs `npm install @nestjs/terminus@^11 --legacy-peer-deps`.

### Other search plugins

**Other search plugins** (Meilisearch, Typesense, etc.) need to do three things:

1. Index availability **per channel**. For a variant in channel C:
   ```ts
   const overrides = await availabilityService.getOverrides(ctx /* channel C */, productIds);
   const productEnabled = resolveEffectiveEnabled(product.enabled, overrides.get(String(product.id)));
   const indexedEnabled = productEnabled && variant.enabled;
   ```
2. Reindex `productId` when `ProductChannelAvailabilityEvent` fires. Reindex it in `channelId`, or in every channel when `channelId` is `null`.
3. Filter on the indexed per-channel flag **in the search engine query**. Filtering results after pagination gives wrong counts.

## Add-to-cart refusal

Adding a product that is switched off in the channel returns an `OrderInterceptorError`. In core, its `message` is generic ("An error occurred when attempting to modify the Order") and the reason is only in `interceptorError`. With `enableOverridePurchasing` on (the default), the plugin puts the reason in `message` too: **"This product is not available in the current channel"**. That applies to `addItemToOrder`, `addItemsToOrder` and the Admin API's `addItemToDraftOrder`.

- The message goes through Vendure's i18n under `errorResult.PRODUCT_DISABLED_IN_CHANNEL`, so you can translate it: `i18nService.addTranslation('de', { errorResult: { PRODUCT_DISABLED_IN_CHANNEL: '…' } })`.
- `interceptorError` always holds the English text (`PRODUCT_DISABLED_IN_CHANNEL_MESSAGE`), whatever the options.
- `adjustOrderLine` (raising the quantity of a line whose product was switched off) still has core's generic `message`; read `interceptorError` there.

The checkout refusal (`transitionOrderToState` to `ArrangingPayment`) already carries a readable message naming the order lines.

## Limitations

- **Guest-cart merge at login.** Vendure's `OrderService.mergeOrders` calls core `addItemsToOrder` directly, and plugins can't override that. Suppose a customer adds a product that is *globally disabled but enabled in this channel* to a guest cart, then logs in while they already have an active cart. Core's merge rejects that line, the same way core treats any globally disabled product. Products that are globally enabled are not affected.
- **Changes during payment.** A product disabled *after* the order reached `ArrangingPayment` is not blocked at payment time; core does the same for globally disabled products.
- **Admin `modifyOrder`.** Core doesn't check `enabled` when an admin modifies a placed order, and the plugin keeps that behaviour.
- **Resolver overrides.** The plugin overrides these Shop API resolvers, using the override mechanism documented by Vendure: `products`, `product`, `Collection.productVariants`, `addItemToOrder` and `addItemsToOrder`. It also overrides the Admin API `addItemToDraftOrder`. Another plugin overriding the same fields would conflict. In that case, turn off `enforceCatalog` and/or `enableOverridePurchasing` and call `ChannelProductAvailabilityService` from your own resolver.
- **Large override sets.** The Shop API product list filters with `id IN (...)` on the overridden ids for the channel, which is fine for thousands of overrides per channel. The custom-query helpers use a subquery instead and have no such limit.
- **Other plugins adding to orders.** Code that calls `OrderService.addItemToOrder` / `addItemsToOrder` directly (re-order, gift-with-purchase promotions, order transfer) bypasses the plugin's resolvers. Products switched **off** in a channel are still refused, because the plugin's `OrderInterceptor` runs inside `OrderService`. Products globally off but switched **on** in a channel are refused by core there, as with the guest-cart merge above.
- **Interceptors called twice.** When an override-enabled product (globally disabled) is added, third-party `OrderInterceptor`s receive both `willAddItemToOrder` and `willAdjustOrderLine`.

## Compatibility

| Vendure | Database | Elasticsearch plugin | Status |
|---|---|---|---|
| 3.8.0 | SQLite (sql.js) | 1.1.0 (Elasticsearch 9.1) | ✅ 104/104 tests pass |
| 3.8.0 | Postgres 16 | 2.0.0 (Elasticsearch 9.1) | ✅ 104/104 tests pass |
| 3.6.1 | SQLite (sql.js) | 1.1.0 (Elasticsearch 9.1) | ✅ 104/104 tests pass |
| 3.6.1 | Postgres 16 | 1.1.0 (Elasticsearch 9.1) | ✅ 81/81 e2e tests pass |
| 3.7.x | — | — | expected to work, not tested |
| MySQL / MariaDB | — | — | migration is database-agnostic; not tested |

Peer dependencies: `@vendure/core ^3.6.0`; optionally `@vendure-community/elasticsearch-plugin ^1.1.0 || ^2.0.0` (only for the `/elasticsearch` entry point). Run the suite against any release with `./scripts/test-against-vendure.sh <version>`; add `ES_PLUGIN_VERSION=… ELASTICSEARCH_PORT=…` for the Elasticsearch tests.

## Development

```bash
npm run build                 # codegen + compile to dist/
npm test                      # unit + e2e (sql.js)
npm run test:e2e:postgres     # e2e on a real Postgres (PGHOST/PGUSER/PGPASSWORD)
ELASTICSEARCH_PORT=9200 npm run test:e2e:elasticsearch   # against a real Elasticsearch 9
./scripts/test-against-vendure.sh 3.8.0
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for every core code path involved and the extension point used for each.

## License

MIT
