# Changelog

## 1.2.0

Additive: nothing existing changes. Based on the handoff from the first production consumer.

### Added

- **Elasticsearch support** for `@vendure-community/elasticsearch-plugin` 1.1.0 and 2.0.0, as a separate entry point (`…/elasticsearch`, optional peer dependency):
  - `withChannelAvailability(options)` adds a per-channel availability field to the variant index and swaps the Shop API `enabled` filter for it, wrapped around any existing `mapQuery`. It keeps a rollout fallback for documents indexed before the field existed.
  - `ChannelAvailabilityElasticsearchPlugin` reindexes products when overrides are set or cleared, debounced per product.
  - The pieces are exported for manual wiring: `channelEnabledVariantMapping`, `channelEnabledIndexMapping`, `applyChannelAvailabilityFilter`, `CHANNEL_ENABLED_FIELD`.
  - Handles a quirk of the Elasticsearch indexer, which marks every variant of a globally disabled product as disabled before custom mappings run. Products that are globally off but switched on in a channel are indexed as available there.
- **Helpers for custom queries** on `ChannelProductAvailabilityService`:
  - `filterAvailableVariantIds` and `filterAvailableProductIds` (keep the input order);
  - `applyToQueryBuilder` and `applyToVariantQueryBuilder` (a subquery, so no id lists or `IN ()`, safe to call twice);
  - `getAvailableProductIdsSubQuery` (raw SQL);
  - `getEffectiveEnabledVariantFilter` and `getEffectivelyDisabledProductIds`.
  - `enforceGuardFilter` is exported.
- **Bulk operations:**
  - `setProductChannelAvailabilities` / `clearProductChannelAvailabilities` mutations, and `setOverrides` / `clearOverrides` on the service;
  - partial success with skip reasons, batched writes in one transaction, a permission check per channel, at most 1,000 pairs per call, one event per changed pair.
- **Overrides list:** `productChannelAvailabilityOverrides` accepts `productName` and returns `productName` and `productEnabled`.
- **Dashboard:**
  - an **Availability in channels…** bulk action in the product list;
  - a **Catalog → Channel availability** page (bulk change with a result summary; per-channel overrides with search, filter, paging and inline clear).

### Changed

- Adding a product switched off in the channel now returns its reason in the error's `message` ("This product is not available in the current channel", translatable under `errorResult.PRODUCT_DISABLED_IN_CHANNEL`) instead of core's generic text. `interceptorError` is unchanged.

### Verified

- Dashboard rendered and click-tested on Vendure 3.8 (light and dark), including a consumer `vite build` from the packed package with no extra dependencies.
- Test suite (104 tests) passes on Vendure 3.6.1 and 3.8.0, SQLite and Postgres, and against a real Elasticsearch 9 with both Elasticsearch plugin versions.

## 1.1.0

### Changed

- Redesigned the Dashboard "Channel availability" block:
  - each channel has a **Global / On / Off** segmented control; Global shows what it currently resolves to
  - an "Available in X of Y channels" summary and a global-status pill
  - callouts when the product is globally disabled but still sold somewhere, or globally enabled but hidden somewhere
  - changes apply instantly and roll back if the server rejects them; toasts name the product and channel
  - readable channel names ("Default channel"), a "Current" marker, and view-only rows (with a lock icon) for channels where the admin lacks update permission
  - skeleton loading and styled permission/error states; refreshes when the product's own Enabled switch is saved

### Fixed

- Dashboard on Vendure 3.8: the "Unavailable" badge used `variant="secondary"`, which no longer exists in `@vendure-io/ui` 2.x and rendered unstyled. The block now uses only primitives shared by `@vendure-io/ui` 1.x and 2.x.

## 1.0.0

Initial release.

### Added

- `ProductChannelAvailability` entity: sparse per-(product, channel) overrides of `Product.enabled`, with a unique key, a lookup index and cascading foreign keys.
- `ChannelProductAvailabilityMigration1792195200000`: an opt-in migration built from the entity metadata, so it works on any supported database.
- `ChannelProductAvailabilityService`: the single source of truth for the rule. Reads are batched and cached per request; writes are idempotent and concurrency-safe.
- Shop API enforcement for `products`, `product` and `Collection.productVariants`, applied in SQL so counts and pagination stay correct.
- DefaultSearchPlugin index sync: overrides are applied when index rows are written and patched immediately when an override changes.
- Purchasing of products that are globally disabled but enabled in a channel, via the shop `addItemToOrder` / `addItemsToOrder` and admin `addItemToDraftOrder` mutations.
- `OrderInterceptor` that rejects adding, or increasing the quantity of, explicitly disabled products.
- `OrderProcess` that blocks checkout while the cart still contains explicitly disabled products.
- Admin API queries and mutations, with permission checks in the target channel.
- `ProductChannelAvailabilityEvent`, plus clean-up of overrides when a product is deleted, a product is removed from a channel, or a channel is deleted.
- React Dashboard block on the product detail page.
- Tested on Vendure 3.6.1 and 3.8.0, each on Postgres and SQLite.
