# @rahul_vendure/vendure-meilli-search

A Vendure plugin that replaces the default search with [Meilisearch](https://www.meilisearch.com/) — a fast, typo-tolerant search engine with full-text search and optional AI-powered hybrid (semantic + keyword) search.

> **Note:** This plugin is a drop-in replacement for the `DefaultSearchPlugin`. Make sure to remove `DefaultSearchPlugin` from your Vendure config before adding `MeilisearchPlugin`.

## Features

- Full-text search with typo tolerance, synonyms, and stop words
- Optional AI hybrid search (semantic + keyword) via Meilisearch's native vector store
- `similarDocuments` query for "more like this" / product recommendations
- Faceted search, collection filtering, price range filtering
- Price range buckets for building filter UIs
- Configurable matching strategy, highlighting, cropping, and ranking
- Custom product & variant field mappings
- Buffered index updates
- Health check endpoint

## Requirements

- Vendure `^3.0.0`
- Node.js **20.19+ or 22.12+** (the Meilisearch JS SDK is ESM-only and is loaded with `require(esm)`)
- A running [Meilisearch](https://www.meilisearch.com/docs/learn/getting_started/cloud_quick_start) instance **v1.6 or later** (required for `matchingStrategy: 'frequency'`, `distinct`, `facetStats`, and `swapIndexes` features used by this plugin). Tested with **v1.13** and **v1.55**. On v1.14+ the plugin uses [granular filterable attributes](https://www.meilisearch.com/docs/reference/api/settings#filterable-attributes), which make indexing cheaper.
- For AI hybrid search: Meilisearch **v1.13 or later** with the vector store available, plus an embedding provider (OpenAI, HuggingFace, Ollama, a REST embedder, or your own vectors)

## Installation

```bash
# npm
npm install @rahul_vendure/vendure-meilli-search

# yarn
yarn add @rahul_vendure/vendure-meilli-search

# pnpm
pnpm add @rahul_vendure/vendure-meilli-search
```

## Quick Start

### Minimal Setup (Full-Text Search Only)

```ts
import { MeilisearchPlugin } from '@rahul_vendure/vendure-meilli-search';

export const config: VendureConfig = {
  plugins: [
    MeilisearchPlugin.init({
      host: 'http://localhost:7700',
      apiKey: 'your-master-key',
    }),
  ],
};
```

After startup, run the `reindex` mutation from the Admin API to populate the search index.

### With AI Hybrid Search

```ts
MeilisearchPlugin.init({
  host: 'http://localhost:7700',
  apiKey: 'your-master-key',
  ai: {
    embedders: {
      default: {
        source: 'openAi',
        model: 'text-embedding-3-small',
        apiKey: process.env.OPENAI_API_KEY,
        documentTemplate: "A product called '{{doc.productName}}' - {{doc.description | truncatewords: 20}}",
      },
    },
    semanticRatio: 0.5,
  },
})
```

AI is fully opt-in: without an `ai` block the plugin is a plain keyword search plugin. See [AI Hybrid Search](#ai-hybrid-search) for cost, secret handling, and testing guidance.

## Full Configuration Reference

```ts
MeilisearchPlugin.init({

  // ─── Connection ────────────────────────────────────────────
  host: 'http://localhost:7700',          // Meilisearch server URL
  apiKey: 'your-master-key',             // Master/admin API key
  connectionAttempts: 10,                 // Retry attempts on startup
  connectionAttemptInterval: 5000,        // ms between retries

  // ─── Indexing ──────────────────────────────────────────────
  indexPrefix: 'vendure-',                // Index name prefix (useful for multi-project)
  reindexProductsChunkSize: 2500,         // Products loaded per DB query during reindex
  reindexBatchSize: 1000,                 // Documents sent to Meilisearch per batch
  bufferUpdates: false,                   // Buffer updates instead of immediate indexing
  taskTimeout: 300000,                    // ms to wait for a Meilisearch task (raise for AI indexing)

  // ─── Search Query Config ───────────────────────────────────
  searchConfig: {
    // Matching
    matchingStrategy: 'frequency',        // 'last' | 'all' | 'frequency'
    attributesToSearchOn: ['productName', 'description', 'sku'],
    rankingScoreThreshold: 0.15,          // 0.0-1.0, filter out weak results

    // Highlighting
    attributesToHighlight: ['productName', 'description'],
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',

    // Cropping
    attributesToCrop: ['description'],
    cropLength: 30,
    cropMarker: '...',

    // Debug / scoring
    showRankingScore: true,
    showRankingScoreDetails: false,
    showMatchesPosition: false,

    // Response
    attributesToRetrieve: ['*'],          // Fields to return

    // Internal limits
    facetValueMaxSize: 50,
    collectionMaxSize: 50,
    totalItemsMaxSize: 10000,
    priceRangeBucketInterval: 1000,       // Price bucket width (in currency subunits)
    groupedFacetCountLimit: 1000,         // Exact product counts for facets up to this many matching variants

    // Hooks
    mapQuery: (query, input, searchConfig, channelId, enabledOnly, ctx) => {
      // Modify the raw Meilisearch query before it's sent
      return query;
    },
    mapSort: (sort, input) => sort,
  },

  // ─── Typo Tolerance ────────────────────────────────────────
  typoTolerance: {
    enabled: true,
    minWordSizeForOneTypo: 4,             // Default: 5
    minWordSizeForTwoTypos: 8,            // Default: 9
    disableOnWords: ['iPhone', 'Samsung'],
    disableOnAttributes: ['sku'],
    disableOnNumbers: true,               // No typos on numbers (Meilisearch v1.15+)
  },

  // ─── Synonyms ──────────────────────────────────────────────
  synonyms: {
    phone: ['mobile', 'smartphone', 'cellphone'],
    laptop: ['notebook'],
    tv: ['television', 'monitor'],
  },

  // ─── Stop Words ────────────────────────────────────────────
  stopWords: ['the', 'a', 'an', 'is', 'for', 'and', 'of'],

  // ─── Ranking Rules ─────────────────────────────────────────
  rankingRules: [
    'words', 'typo', 'proximity', 'attribute',
    'sort', 'exactness', 'productInStock:desc',
  ],

  // ─── AI / Hybrid Search (optional) ─────────────────────────
  ai: {
    embedders: {
      default: {
        source: 'openAi',                // 'openAi' | 'huggingFace' | 'ollama' | 'rest' | 'userProvided'
        model: 'text-embedding-3-small',
        apiKey: process.env.OPENAI_API_KEY,
        documentTemplate: "A product called '{{doc.productName}}' - {{doc.description | truncatewords: 20}}",
        documentTemplateMaxBytes: 400,
        // For 'rest' and 'ollama' sources:
        // url: 'https://api.example.com/embed',
        // request: { ... },
        // response: { ... },
        // headers: { ... },
        // For 'userProvided' source:
        // dimensions: 1536,
      },
    },
    defaultEmbedder: 'default',           // Which embedder to use by default
    semanticRatio: 0.5,                   // 0.0 = keyword only, 1.0 = semantic only
  },

  // ─── Custom Mappings ───────────────────────────────────────
  customProductMappings: {
    reviewRating: {
      graphQlType: 'Float',
      valueFn: (product, variants, languageCode, injector, ctx) => {
        return product.customFields?.reviewRating ?? 0;
      },
    },
  },
  customProductVariantMappings: {
    warehouse: {
      graphQlType: 'String',
      valueFn: (variant, languageCode, injector, ctx) => {
        return variant.customFields?.warehouse ?? '';
      },
    },
  },

  // ─── Hydration (extra DB relations for custom mappings) ────
  hydrateProductRelations: ['customFields'],
  hydrateProductVariantRelations: ['customFields'],

  // ─── Extend GraphQL Input ──────────────────────────────────
  extendSearchInputType: {
    reviewRating: 'Float',
  },
  extendSearchSortType: ['reviewRating'],

  // ─── Any other Meilisearch index setting (advanced) ────────
  indexSettings: {
    searchCutoffMs: 300,
    separatorTokens: ['/'],
    proximityPrecision: 'byAttribute',
  },
})
```

## Index Settings

The plugin owns the settings of its index and keeps them in sync with the config:

- **Applied at every startup**, compared with the live settings first. Nothing is sent when they already match; otherwise **one** settings update with only the changes goes out, in the background (startup isn't blocked while Meilisearch re-indexes). A config change such as new synonyms takes effect after a restart; no full reindex needed.
- **Removing an option resets it.** Delete `synonyms`, `stopWords`, `rankingRules` or `typoTolerance` from the config and the index goes back to Meilisearch's defaults. Removed embedders are removed from the index.
- **`indexSettings`** passes any other [Meilisearch setting](https://www.meilisearch.com/docs/reference/api/settings) through (e.g. `searchCutoffMs`, `separatorTokens`, `dictionary`, `localizedAttributes`, `proximityPrecision`). It's merged over the plugin's settings; the lists the plugin relies on (filterable, searchable, sortable attributes) are extended, not replaced.
- Facet values are sorted **by count** (`faceting.sortFacetValuesBy`), so when a facet has more values than the limit, the most frequent ones are kept rather than the first alphabetically.

Embedders are updated in a separate task, so a provider problem (bad key, unreachable URL) can't hold back the keyword settings.

## Matching Strategy

Controls how Meilisearch matches multi-word queries:

| Strategy | Behavior | Use When |
|---|---|---|
| `'last'` (default) | Returns results even if not all terms match. Drops least important terms progressively. | You want maximum results / fuzzy matching |
| `'frequency'` | Prioritizes rare/meaningful terms, drops common ones. | Balanced — good default for e-commerce |
| `'all'` | Only returns documents matching **every** query term. | You want strict/exact matching |

## Typo Tolerance

Meilisearch has built-in typo tolerance. The `typoTolerance` config lets you tune it:

```ts
typoTolerance: {
  enabled: true,
  minWordSizeForOneTypo: 4,   // "shrt" matches "shirt" (4+ chars = 1 typo allowed)
  minWordSizeForTwoTypos: 8,  // "smartphne" matches "smartphone" (8+ chars = 2 typos)
  disableOnWords: ['iPhone'],  // Brand names must be exact
  disableOnAttributes: ['sku'], // SKU must be exact
}
```

Lower values = more fuzzy. Higher values = more strict.

| Strictness | `minWordSizeForOneTypo` | `minWordSizeForTwoTypos` |
|---|---|---|
| Loose | 3 | 6 |
| Balanced | 4 | 8 |
| Default | 5 | 9 |
| Strict | 6 | 10 |

## Synonyms

Synonyms let users find products regardless of which word they use. Define synonym groups and the plugin **automatically expands them bidirectionally** — you only need to define one direction:

```ts
synonyms: {
  laptop: ['notebook', 'portable computer'],
  shoe: ['sneaker', 'footwear'],
}
```

The plugin generates all reverse mappings automatically, so searching "notebook" finds laptops and searching "laptop" finds notebooks. No need to manually define both directions.

Synonyms are word-level, not product-level — a small set of 20-30 synonym groups covers your entire catalog regardless of size.

## Highlighting & Cropping

Configure highlighting and cropping in `searchConfig` to help frontends show users *why* a result matched:

```ts
searchConfig: {
  attributesToHighlight: ['productName', 'description'],
  highlightPreTag: '<mark>',
  highlightPostTag: '</mark>',
  attributesToCrop: ['description'],
  cropLength: 30,
}
```

Results include `formattedProductName` and `formattedDescription` fields with matched terms wrapped in highlight tags and long text cropped around the match:

```graphql
{
  search(input: { term: "carbon" }) {
    items {
      productName              # "Road Bike"
      formattedProductName     # "Road Bike"
      description              # full raw description
      formattedDescription     # "…full <mark>carbon</mark> chassis with cyclocross-specific…"
    }
  }
}
```

These fields are `null` when highlighting/cropping is not configured — frontends can fall back to `productName` / `description`.

## AI Hybrid Search

When the `ai` option is configured, every search automatically combines keyword matching with semantic similarity, and the `similarDocuments` query becomes available.

**The plugin never calls OpenAI, HuggingFace, or Ollama itself.** Embedder config is forwarded to Meilisearch, which owns the provider integration, generates the embeddings, and stores the vectors. That keeps the surface small: a breaking change at a provider is a Meilisearch concern, not a plugin concern.

### Supported Embedder Sources

| Source | Description |
|---|---|
| `'openAi'` | OpenAI API (recommended, works best for most use cases) |
| `'huggingFace'` | HuggingFace models running on the Meilisearch server |
| `'ollama'` | Self-hosted Ollama models (requires `url`) |
| `'rest'` | Any REST API embedder — Mistral, Cloudflare, Voyage, etc. (requires `url`) |
| `'userProvided'` | You compute and supply your own embeddings (requires `dimensions`) |

Configuration is validated at startup: an unknown `defaultEmbedder`, a `semanticRatio` outside `0..1`, an `ollama`/`rest` embedder without a `url`, or a `userProvided` embedder without `dimensions` throws immediately instead of failing at query time.

### API keys and secrets

`apiKey` is forwarded to Meilisearch **in plaintext** and stored in that index's settings. The plugin does no encryption, rotation, or secret-store integration.

- Always load it from an environment variable or a secret manager — never commit it.
- Anyone with admin access to your Meilisearch instance can read it back from the index settings.
- Meilisearch only returns the key masked, so the startup settings sync can't tell that it changed. After rotating the key, run a `reindex`: it builds a fresh index with the full settings, including the new key.
- The `rest` source is an open passthrough: `url`, `headers`, and `request` let you point at any HTTP endpoint. Pointing it at an internal service is your call and your security surface.

### Cost

Embeddings are generated for **every indexed document**, and hybrid search runs on **every query**. With a paid provider this is real money on a large catalog:

| Catalog size | Model | Approx. one-off cost of a full reindex |
|---|---|---|
| 1,000 variants | `text-embedding-3-small` | well under $0.01 |
| 100,000 variants | `text-embedding-3-small` | a few cents |
| 100,000 variants | `text-embedding-3-large` | roughly 6-7× the above |

Costs scale with `documentTemplate` length, so keep templates short (15-45 words) and include only fields that carry meaning. Full reindexes re-embed everything; incremental updates only re-embed changed documents. Query-side embedding of the search term is charged per search, so high-traffic stores should budget for query volume too.

To run without any provider cost — in dev, CI, or e2e tests — use the `userProvided` source and supply your own vectors, or simply omit the `ai` block to fall back to keyword search.

### `totalItems` with hybrid search

With `ai` configured, every search is a hybrid search, and Meilisearch ranks the whole
filtered set rather than only the documents that matched the keywords. `totalItems`
therefore reports the size of that hybrid candidate set — often the entire catalog —
because that genuinely is how many results paging through the query would return.

Measured on a 1,036-product channel:

| Query | Keyword-only matches | Hybrid `totalItems` |
|---|---|---|
| `biscuit` (exact matches exist) | 14 | 14 |
| `biscut` (typo) | 14 | 1036 |
| `something sweet to eat with tea` | 0 | 1036 |

If you want `totalItems` to mean "results worth showing", set a
`searchConfig.rankingScoreThreshold` to drop weak semantic matches. On the same data,
the third query above returns 1036 with no threshold, 104 at `0.1`, and 19 at `0.2`.
The plugin applies the same threshold to `similarDocuments`.

### Semantic Ratio

Controls the balance between keyword and semantic results:

```
0.0  ──────────── 0.5 ──────────── 1.0
pure keyword     balanced      pure semantic
```

### Embeddings & Reindex

- Embeddings are generated by the **Meilisearch server**, not this plugin.
- A full reindex builds a fresh index and regenerates every embedding (this is where provider cost is incurred).
- Incremental updates (product edits) only re-embed the affected documents.
- Removing the `ai` config and restarting switches to keyword-only search immediately. Reindex to drop the old vectors.
- During the reindex swap window the primary index can briefly lack embedder settings. A hybrid search arriving in that window falls back to keyword search and logs a warning rather than failing the request. A *repeating* warning outside a reindex means the embedder is genuinely misconfigured.

### Similar Documents

When AI is enabled, the Shop and Admin APIs expose a `similarDocuments` query:

```graphql
query {
  similarDocuments(input: {
    id: "1_42_en"        # channelId_variantId_languageCode
    limit: 10
  }) {
    items {
      productName
      productId
    }
    totalItems
  }
}
```

Results are always scoped to the requesting channel and language, and to enabled products on the Shop API. Pass `groupByProduct: true` to collapse variants of the same product so a carousel does not show the same product several times.

The query **errors** rather than returning an empty list when AI is not configured or the named embedder is unknown, so a storefront carousel fails loudly in development instead of silently rendering nothing in production.

## Price Range Buckets

The `priceRangeBucketInterval` controls how search results are grouped into price bands in the response. This data powers price filter UIs:

```ts
searchConfig: {
  priceRangeBucketInterval: 2000, // Each bucket spans $20 (2000 cents)
}
```

Response includes:
```json
{
  "prices": {
    "range": { "min": 500, "max": 15000 },
    "buckets": [
      { "to": 2000, "count": 23 },
      { "to": 4000, "count": 45 },
      { "to": 6000, "count": 12 }
    ]
  }
}
```

This is **separate** from the `priceRange` input filter, which lets users filter results by price.

All buckets are counted in a single [multi-search](https://www.meilisearch.com/docs/reference/api/multi_search) request.

## Facet and Collection Counts

`facetValues` and `collections` in the search response follow the same rules as Vendure's Elasticsearch plugin:

- Not grouped: the number of matching **variants** with that facet value / in that collection.
- `groupByProduct: true` (or `groupBySKU`): the number of distinct **products** (SKUs) with a matching variant that has the value.

Meilisearch's facet distribution always counts documents (variants), so for grouped searches the plugin counts products itself, as long as at most `searchConfig.groupedFacetCountLimit` (default 1000) variants match. For bigger result sets it falls back to Meilisearch's per-variant counts. Values are returned most frequent first.

## Result Limits

Meilisearch caps result counts at the index level: `pagination.maxTotalHits` (default 1000) bounds `totalItems`, and `faceting.maxValuesPerFacet` (default 100) bounds facet distributions. Left at their defaults, a catalog larger than those numbers silently reports truncated counts.

The plugin configures both from `searchConfig`, so `totalItemsMaxSize` (default 10000) and `max(facetValueMaxSize, collectionMaxSize)` are the values that actually apply. Raise `totalItemsMaxSize` if your catalog exceeds it — the new limit is applied at the next startup.

## Multi-Project Setup

If multiple Vendure projects share the same Meilisearch instance, use different `indexPrefix` values:

```ts
// Project A
MeilisearchPlugin.init({ indexPrefix: 'shop-a-', ... })

// Project B
MeilisearchPlugin.init({ indexPrefix: 'shop-b-', ... })
```

This creates separate indexes (`shop-a-variants`, `shop-b-variants`) so reindexing one doesn't affect the other.

`indexPrefix` may only contain alphanumeric characters, hyphens, underscores, and dots (dots are normalised to hyphens in the index UID). Anything else throws at startup — this is deliberate, because silently stripping invalid characters would let `shop@a-` and `shopa-` collide on the same index.

## Admin API

The plugin extends the Admin API with:

```graphql
# Rebuild the entire search index
mutation { reindex { ... } }

# Run buffered updates (when bufferUpdates: true)
mutation { runPendingSearchIndexUpdates { ... } }
```

## Buffered Updates

By default, changes to products, variants, and collections trigger immediate index updates. For high-traffic stores where frequent writes cause excessive indexing load, enable buffered updates:

```ts
MeilisearchPlugin.init({
  bufferUpdates: true,
  // ...
})
```

When enabled, index updates are accumulated and only applied when you explicitly run:

```graphql
mutation { runPendingSearchIndexUpdates { success } }
```

This can be triggered on a schedule (e.g. via a cron job or the Vendure `SchedulerPlugin`) to batch updates.

## Troubleshooting

### Meilisearch is unreachable at startup

The plugin retries the connection up to `connectionAttempts` times (default: 10) with `connectionAttemptInterval` ms between retries (default: 5000ms). If all attempts fail, the server starts but search will not work and the health check will report unhealthy. Check that your Meilisearch instance is running and accessible at the configured `host`.

### Search returns no results after startup

Run the `reindex` mutation from the Admin API. The plugin does not automatically populate the index on first startup — an explicit reindex is required.

### Stale results after product changes

If `bufferUpdates` is enabled, changes are not applied until `runPendingSearchIndexUpdates` is called. If `bufferUpdates` is `false` (default), updates should be near-instant — check that the Vendure job queue is running.

### Reindex fails with "timeout ... has exceeded on task N"

A Meilisearch task took longer than `taskTimeout` (default 5 minutes). This is most likely with AI embedders configured, where Meilisearch calls the embedding provider for every document in a batch. Raise `taskTimeout`, lower `reindexBatchSize` so each batch is smaller, or check that the embedding provider is responding.

### A reindex or an update fails with `Meilisearch task N (...) failed: [code] message`

Meilisearch rejected the task. The plugin checks every task it waits for and fails the job instead of reporting success with documents missing. The code and message come from Meilisearch (e.g. `invalid_document_id`, `invalid_settings_filterable_attributes`); see [Meilisearch error codes](https://www.meilisearch.com/docs/reference/errors/error_codes).

### Hybrid search silently returns keyword results

Look for a `Embedder "..." is not available on index ...` warning in the logs. During a reindex this is expected and self-corrects once the swap completes. Outside a reindex it means Meilisearch could not apply the embedder settings — check the provider API key, the `url` for `ollama`/`rest` sources, and that your Meilisearch version supports the vector store.

### `similarDocuments` returns an error

The query requires `ai.embedders` to be configured, and the `embedder` argument (when given) must name a configured embedder. Both cases throw a user input error naming the available embedders.

## Custom Mappings

Add extra data to the search index:

```ts
customProductMappings: {
  brand: {
    graphQlType: 'String',
    public: true, // Exposed in GraphQL (default: true)
    valueFn: (product, variants, languageCode, injector, ctx) => {
      return product.customFields?.brand ?? '';
    },
  },
},
```

Access in GraphQL:

```graphql
query {
  search(input: { term: "shoes" }) {
    items {
      customProductMappings {
        brand
      }
    }
  }
}
```

## Hooks

### `mapQuery`

Intercept and modify the raw Meilisearch query before it's sent:

```ts
searchConfig: {
  mapQuery: (query, input, searchConfig, channelId, enabledOnly, ctx) => {
    // Example: boost in-stock products for logged-in users
    if (ctx.activeUser) {
      query.sort = ['inStock:desc', ...(query.sort || [])];
    }
    return query;
  },
}
```

### `mapSort`

Modify the sort parameters:

```ts
searchConfig: {
  mapSort: (sort, input) => {
    if (input.sort?.myCustomField) {
      sort.push(`variant-myCustomField:${input.sort.myCustomField === 'ASC' ? 'asc' : 'desc'}`);
    }
    return sort;
  },
}
```

## Exported Types

```ts
import {
  MeilisearchPlugin,
  MeilisearchOptions,
  SearchConfig,
  MatchingStrategy,
  TypoToleranceConfig,
  EmbedderConfig,
  AiSearchConfig,
  SimilarDocumentsInput,
} from '@rahul_vendure/vendure-meilli-search';
```

## Running the tests

Unit tests run without any services. The end-to-end tests (`e2e/`) start a Vendure test server and need a Meilisearch server:

```bash
docker run -d -p 7701:7700 -e MEILI_MASTER_KEY=test-master-key getmeili/meilisearch:v1.55
npm test   # MEILI_HOST / MEILI_MASTER_KEY override the defaults
```

## License

MIT
