# Changelog

All notable changes to `@rahul_vendure/vendure-meilli-search` are documented here.
This project follows [semantic versioning](https://semver.org/).

## 2.0.0

A correctness-focused release. It folds in the full review of the
[Vendure community-plugins PR](https://github.com/vendurehq/community-plugins/pull/14)
and adds fixes found by running the plugin against a real 4,000-product catalogue with
live embeddings.

### Breaking changes

- **`similarDocuments` now throws instead of returning an empty result set.** When AI
  search is not configured, or the requested embedder is not one of the configured
  embedders, the query raises a user input error naming the available embedders. A
  storefront carousel now fails loudly in development instead of silently rendering
  nothing in production.
- **`similarDocuments` results are scoped to the requesting channel and language**, and
  to enabled products on the Shop API. Previously the query ran unfiltered across the
  whole index, so a Shop API call in one channel could return documents belonging to
  another channel, and the same product could appear once per channel it was assigned to.
  A caller-supplied `filter` is now parenthesised before being ANDed with that scope, so
  its own `OR` clauses cannot widen the channel scope.
- **`searchConfig.mapQuery` is typed as `MeilisearchQueryParams`** (the Meilisearch SDK's
  `SearchParams`) instead of `any`. Callbacks written as `(query) => query` are
  unaffected; explicitly typed callbacks may need their signature updated.
- **An invalid `indexPrefix` now throws at startup.** Characters outside
  `[a-zA-Z0-9_-.]` were previously stripped when building the index UID, so
  `shop@a-` and `shopa-` silently shared one index.
- **`totalItems` returns different (correct) values** — see the counting fixes below.

### Fixed

- **`totalItems` was capped at 100.** The plugin never configured Meilisearch's
  `pagination.maxTotalHits` (default 1000) or `faceting.maxValuesPerFacet` (default 100),
  so any catalogue larger than those limits silently reported truncated totals and facet
  counts. Both are now derived from `searchConfig.totalItemsMaxSize` and
  `max(facetValueMaxSize, collectionMaxSize)` when the index is configured.
- **`totalItems` was 0 for semantic queries that returned results.** The count query ran
  keyword-only while the search itself ran hybrid. Counting and searching now share the
  same parameters, including the hybrid ones, so the total always describes the result
  set actually returned.
- **Distinct counting is now exhaustive.** Grouped counts used a facet distribution over
  `productId`, which is bounded by `maxValuesPerFacet`; they now use page-based
  pagination, whose `totalHits` is both exhaustive and `distinct`-aware.
- **Indexing with embedders configured could not complete.** Every task wait used the
  SDK's 5 second default, which expires while Meilisearch calls the embedding provider
  for a batch. Added a `taskTimeout` option (default 5 minutes) applied to every task wait.
- **A failed reindex left its temporary index behind**, accumulating scratch indexes on
  the Meilisearch instance. Every failure path now cleans up.
- **A failed reindex could report success.** Errors from document batches, document
  deletes, and the index swap are rethrown instead of only logged, so the job fails
  instead of promoting a partial index over good data.
- **`deleteProductOperations` used the wrong channel scope**, so deleting a product from
  a context whose channel the product did not belong to left it in the index.
- **`deleteVariants` bypassed the async queue**, allowing a delete to race an in-flight
  update for the same product.
- **Filter strings were built by raw interpolation.** Collection slugs, collection ids
  and facet values now go through an escape helper, so a value containing `"` or `\`
  can no longer corrupt or widen the filter.
- **The index swap no longer sends `rename`.** Passing `rename: false` was observed to
  stop index settings (embedders included) from carrying across the swap.
- Health checks ping once instead of running the full connection-retry loop, which could
  block a probe for up to 50 seconds.
- Event subscriber handlers attach `.catch`, so a failing handler no longer surfaces as
  an unhandled rejection on the RxJS subscription.
- Startup errors log `e.message`/`e.stack` rather than `JSON.stringify(e)`, which
  produces `{}` for `Error` instances.
- `Math.min(...prices)` replaced with `reduce`, which does not throw on very large arrays.

### Added

- `taskTimeout` option — how long to wait for a Meilisearch task before failing.
- `groupByProduct` on `similarDocuments`, collapsing variants of the same product.
- `similarDocuments` honours `searchConfig.rankingScoreThreshold`.
- Startup validation of the `ai` config: at least one embedder, a `defaultEmbedder` that
  exists, `semanticRatio` within `0..1`, a `url` for `ollama`/`rest` sources, and
  `dimensions` for `userProvided`.
- Bidirectional synonym expansion — define `laptop: ['notebook']` and the reverse mapping
  is generated automatically.
- `formattedProductName` and `formattedDescription` on `SearchResult`, exposing
  Meilisearch highlight and crop output.
- Plural `collectionIds` / `collectionSlugs` search filters.
- `MeilisearchQueryParams` exported for typing `mapQuery` implementations.
- Unit tests (39) for `buildFilter`, `buildSort`, `escapeFilterValue` and
  `expandSynonymsBidirectional`; run with `npm test`.
- README sections on AI cost and secret handling, hybrid `totalItems` behaviour with
  measured numbers, result limits, buffered updates, and troubleshooting.

### Changed

- Price bucket generation runs in parallel batches (concurrency 10) instead of one
  sequential request per bucket, and logs per-bucket failures instead of swallowing them.
- `buildFilter` / `buildSort` extracted into `build-search-query.ts` as pure, testable
  functions.
- `reindex` split into `createTempIndex`, `populateTempIndex` and `swapAndPromote`.
- `MeilisearchService` implements `OnModuleDestroy`, and the two client instances are
  documented as deliberate.
- `MeilisearchPlugin.init()` warns when called more than once.

## 1.0.1

- README.

## 1.0.0

- Initial release: Meilisearch-backed replacement for `DefaultSearchPlugin` with
  full-text search, faceting, collection and price filtering, custom mappings, buffered
  updates, and opt-in AI hybrid search.
