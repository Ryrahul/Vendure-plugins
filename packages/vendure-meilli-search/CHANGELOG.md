# Changelog

All notable changes to `@rahul_vendure/vendure-meilli-search` are documented here.
This project follows [semantic versioning](https://semver.org/).

## 3.0.0

Brings the plugin in line with current Meilisearch (tested with v1.13 and v1.55) and fixes
four indexing and counting bugs, each reproduced against a real Meilisearch server first.
The search schema and results stay compatible with Vendure's Elasticsearch plugin.

### Breaking changes

- **Node.js 20.19+ or 22.12+ is required.** The Meilisearch JS SDK is upgraded from 0.55 to
  0.62, which is ESM-only and is loaded through `require(esm)`.
- **Index settings are synced at startup and options you remove are reset.** Deleting
  `synonyms`, `stopWords`, `rankingRules`, `typoTolerance` or an embedder from the config
  now resets it in Meilisearch on the next start. Changes made directly in Meilisearch to
  the settings the plugin manages are overwritten; put them in the new `indexSettings` option.
- **Grouped facet and collection counts are product counts** (see Fixed). Storefronts showing
  these numbers will see smaller, correct values.
- **Facet values and collections are returned most frequent first.**

### Fixed

- **Failed Meilisearch tasks were treated as successes.** The SDK resolves `waitForTask` for
  failed tasks too, so a rejected document batch or settings update went unnoticed and the
  index was silently incomplete. Every task is now checked and a failure fails the job with
  Meilisearch's error code.
- **Changing an asset's focal point never reached the index.** The update filtered on
  `productAssetId` / `productVariantAssetId`, which weren't filterable, and went through
  `search` (capped at `maxTotalHits`). The asset ids are now filterable and the update reads
  documents through the documents API and sends only the changed fields.
- **A product disappeared from search while it was being updated.** Its documents were
  deleted and then re-added. New documents are now written first and only documents that no
  longer exist (a deleted variant, a removed channel or translation) are deleted afterwards.
- **Grouped facet and collection counts counted variants.** With `groupByProduct`, a facet
  value on a product with three variants counted three. Counts now follow the Elasticsearch
  plugin: distinct products (or SKUs with `groupBySKU`) with a matching variant. Exact up to
  the new `searchConfig.groupedFacetCountLimit` (default 1000) matching variants.
- **Config changes didn't apply to an existing index**: settings were only written when the
  index was created, so new synonyms or a new `totalItemsMaxSize` needed a full reindex.
- **Any error at startup looked like a missing index** (e.g. a wrong API key led to an attempt
  to create the index). Only `index_not_found` is treated as missing now.
- **Facet truncation dropped the most common values.** Meilisearch sorts facet values
  alphabetically by default, so the cut at `maxValuesPerFacet` kept `a…` values. They are now
  sorted by count.
- **The hybrid-search fallback matched an error message** that Meilisearch has since
  changed. It now checks the error codes `invalid_search_embedder` / `invalid_similar_embedder`.

### Improved

- **Settings go out in one request**, compared with the live settings first; nothing is sent
  when they match. Before, configuring an index took about ten separate settings tasks, each
  of which can make Meilisearch re-index.
- **Faster reindex.** Documents of many products are sent together in `reindexBatchSize`
  batches without waiting for each one (Meilisearch processes queued document tasks
  together); all batches must succeed before the index swap.
- **Granular filterable attributes** on Meilisearch v1.14+: ids and flags use equality-only
  filters, prices comparison filters, none of them facet search. Older engines get the plain
  list.
- **Price buckets in one multi-search request** instead of one search per bucket.
- **Default ranking rules work on every engine version**: when `rankingRules` isn't set the
  plugin asks Meilisearch for its own default instead of sending a list that older engines
  reject.

### Added

- `indexSettings`: any other Meilisearch index setting (`searchCutoffMs`, `separatorTokens`,
  `dictionary`, `localizedAttributes`, `proximityPrecision`…), merged over the plugin's.
- `typoTolerance.disableOnNumbers` (Meilisearch v1.15+).
- `searchConfig.groupedFacetCountLimit`.
- End-to-end tests against a real Meilisearch server (see `e2e/`), alongside the unit tests.

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
