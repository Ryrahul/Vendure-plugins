# Architecture — Channel Product Availability

This document records how Vendure decides whether a product is discoverable and
purchasable, and exactly which **public** extension points this plugin uses to make
that decision channel-aware. Every core reference below was read in the published
`@vendure/core@3.8.0` and `@vendure/core@3.6.1` `dist/` output — not inferred.

## 1. The rule

```
effective(product, channel) =
    override(product, channel) exists ? override.enabled : product.enabled
```

| `Product.enabled` | override | effective |
|---|---|---|
| true  | —     | **enabled**  |
| false | —     | **disabled** |
| true  | true  | **enabled**  |
| true  | false | **disabled** |
| false | true  | **enabled**  |
| false | false | **disabled** |

* Overrides are sparse rows. No row = inherited. Nothing is back-filled.
* An override never assigns a product to a channel, never touches
  `Product.enabled`, and never bypasses variant `enabled`, stock, price, or channel
  membership checks.
* The pure function lives in `src/services/availability-rules.ts` and is the only
  place the rule is expressed. Everything else asks
  `ChannelProductAvailabilityService`.

## 2. Where core consults `Product.enabled`

| # | Code path (core) | What core does | Affects |
|---|---|---|---|
| 1 | `ShopProductsResolver.products` | guard filter `enabled: { eq: true }` passed to `ProductService.findAll` (SQL) | product list, counts, pagination |
| 2 | `ShopProductsResolver.product` | `if (result.enabled === false) return;` | product detail by id/slug |
| 3 | `CollectionEntityResolver.productVariants` (shop) | adds `filter.enabled = {eq:true}` → `ProductVariantService.getVariantsByCollectionId` adds `product.enabled = true` (SQL) | collection variant lists |
| 4 | Default search `IndexerController.saveVariants` | writes `SearchIndexItem.enabled = product.enabled === false ? false : variant.enabled` **per (variant, channel, language[, currency]) row** | `search` results, counts, facets |
| 5 | `OrderService.addItemsToOrder` (also used by `addItemToOrder`, draft orders, order merge) | `if (variant.product.enabled === false) throw EntityNotFoundError` — **before** `OrderInterceptor`s run | add to cart |
| 6 | `OrderService.adjustOrderLines` | **no** product-enabled check | quantity changes |
| 7 | `OrderModifier.getOrCreateOrderLine` → `getProductVariantOrThrow` | checks channel membership + not deleted; **no** enabled check | line creation |
| 8 | Default order process / payment | no product-enabled check | checkout |

Version differences that matter:

* 3.6.1 `products` merges `enabled` into the caller's filter (bypassable with
  `filterOperator: OR`); 3.8.0 nests it with `enforceGuardFilter`. The plugin uses
  the 3.8 semantics on both versions.
* 3.6.1 indexer writes with `repository.save()`; 3.8.0 with `repository.upsert()`.
  Both fire TypeORM `beforeInsert` / `beforeUpdate` listeners (handled in §5).

## 3. Extension points used (all public)

| Concern | Mechanism | Why it is safe |
|---|---|---|
| Storage | `ProductChannelAvailability` entity (plugin `entities`) | standard plugin entity |
| Rule + data access | `ChannelProductAvailabilityService` | single source of truth |
| Product list / detail | Shop resolver override of `products`, `product` | documented "override built-in resolvers"; delegates to core `ProductService` |
| Collection variants | Field resolver override `Collection.productVariants` (shop only; admin delegates unchanged) | same mechanism; delegates to core `ProductVariantService` |
| Search (DefaultSearchPlugin) | TypeORM `EntitySubscriber` on `SearchIndexItem` + direct row patch on override change | rows are already per-channel; the index stays the single filter so counts/pagination/facets are correct |
| Add to cart (special case) | Shop `addItemToOrder` / `addItemsToOrder` and Admin `addItemToDraftOrder` overrides | see §4 |
| Reject explicitly-disabled | `OrderInterceptor` (`willAddItemToOrder`, `willAdjustOrderLine`) | documented since 3.1 |
| Checkout safety | `OrderProcess.onTransitionStart` → `ArrangingPayment` | documented |
| Consistency | `EventBus` listeners for `ProductEvent`, `ProductChannelEvent`, `ChannelEvent` | documented |

No core file is modified and no private method is patched at runtime.

## 4. Purchasing a globally-disabled product (row 5)

Core throws inside `addItemsToOrder` before any hook runs, so this case cannot be
handled by an interceptor. The plugin overrides the add-item mutations and splits
the input:

* **Normal items** (product globally enabled, or no enabling override) → passed
  unchanged to `OrderService.addItemsToOrder`. Core behaviour is untouched; the
  plugin's interceptor rejects explicitly-disabled products.
* **Override-enabled items** (`Product.enabled = false`, override `true`) →
  1. verify variant exists **in the channel**, not deleted, `variant.enabled = true`;
  2. verify order is `AddingItems`/`Draft`;
  3. `OrderModifier.constrainQuantityToSaleable` (stock);
  4. run every configured `willAddItemToOrder` interceptor;
  5. `OrderModifier.getOrCreateOrderLine` (quantity 0) then
     `OrderService.adjustOrderLines` to the target quantity — this re-applies
     order/line limits, `willAdjustOrderLine` interceptors, stock, and
     `applyPriceAdjustments` (promotions, tax, shipping);
  6. if step 5 returns an error and the line is new, the empty line is deleted.

Result types are identical to core (`UpdateOrderItemsResult`,
`UpdateMultipleOrderItemsResult`).

Known differences vs core for override-enabled items only:

* third-party interceptors see `willAddItemToOrder` **and** `willAdjustOrderLine`;
* `OrderService.mergeOrders` (guest cart merged into an existing active order at
  login) calls core `addItemsToOrder` directly and cannot be overridden. See
  README "Limitations".

## 5. Search

`SearchIndexItem` rows are keyed by channel, so per-channel availability is
represented natively. The plugin:

1. **On index write** — `SearchIndexAvailabilitySubscriber.beforeInsert/beforeUpdate`
   rewrites `enabled` for rows whose (product, channel) has an override:
   `override === false → false`, `override === true → variant.enabled`.
   Listener calls for one statement are collected synchronously and resolved with
   one query (micro-task batching) → no N+1.
2. **On override change** — the service patches the existing rows for that
   product/channel in the same transaction, so search reflects the change without
   waiting for a reindex job.

Third-party search plugins (Elasticsearch, Meilisearch, …) must implement the
contract in README §"Search integration contract".

## 6. Data model

```
product_channel_availability
  id           PK (follows the configured EntityIdStrategy)
  createdAt, updatedAt
  productId    FK → product.id  ON DELETE CASCADE
  channelId    FK → channel.id  ON DELETE CASCADE
  enabled      boolean
  UNIQUE (productId, channelId)
  INDEX  (channelId, enabled)
```

* Products are soft-deleted in Vendure, so the FK cascade only covers hard deletes;
  `ProductEvent('deleted')` removes rows for soft deletes.
* `ProductChannelEvent('removed')` removes the row for that channel, keeping the
  invariant "overrides exist only for products assigned to the channel".
* `ChannelEvent('deleted')` + FK cascade remove rows of deleted channels.

## 7. Concurrency and transactions

* All writes go through `TransactionalConnection.getRepository(ctx, …)` and run in
  the caller's `@Transaction()`.
* `setOverride` is an upsert on the unique key → concurrent writers never violate
  the constraint; last writer wins. Writing the current value is a no-op (no
  event).
* Reads in a request are memoised with `RequestContextCacheService`; writes
  invalidate the memo. No cross-request cache → no Redis/cluster invalidation
  problem.
* Events are published through `EventBus`, which defers delivery until the
  transaction commits.

## 8. Authorization

* Admin queries: `ReadCatalog | ReadProduct`; mutations: `UpdateCatalog | UpdateProduct`
  — checked in the **target** channel via the session's per-channel permissions,
  not just the active channel. Passing a foreign `channelId` without permission
  there → `ForbiddenError`.
* Setting an override requires the product to be assigned to the target channel.

## 9. Not in scope / limitations

See README "Limitations" — kept there so consumers read it.
