# Changelog

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
