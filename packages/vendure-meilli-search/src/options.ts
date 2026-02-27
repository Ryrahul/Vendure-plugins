import {
    DeepRequired,
    EntityRelationPaths,
    ID,
    Injector,
    LanguageCode,
    Product,
    ProductVariant,
    RequestContext,
} from '@vendure/core';
import deepmerge from 'deepmerge';

import {
    CustomMapping,
    GraphQlPrimitive,
    MeilisearchSearchInput,
    PrimitiveTypeVariations,
} from './types';

/**
 * @description
 * Configuration for an AI embedder source. Meilisearch supports OpenAI, HuggingFace,
 * Ollama, and generic REST embedders.
 *
 * @example
 * ```ts
 * // OpenAI embedder
 * {
 *   source: 'openAi',
 *   model: 'text-embedding-3-small',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   documentTemplate: "A product called '{{doc.productName}}' described as '{{doc.description}}'",
 * }
 *
 * // Ollama embedder (self-hosted)
 * {
 *   source: 'ollama',
 *   url: 'http://localhost:11434/api/embeddings',
 *   model: 'nomic-embed-text',
 *   documentTemplate: "A product: {{doc.productName}}",
 * }
 * ```
 */
export interface EmbedderConfig {
    /**
     * @description
     * The embedder source. Supported values:
     * - `'openAi'` - OpenAI embeddings (recommended for most use cases)
     * - `'huggingFace'` - HuggingFace models (self-hosted, good for small datasets)
     * - `'ollama'` - Ollama local models
     * - `'rest'` - Any REST API embedder
     * - `'userProvided'` - You generate and provide your own embeddings
     */
    source: 'openAi' | 'huggingFace' | 'ollama' | 'rest' | 'userProvided';
    /**
     * @description
     * The model name to use for generating embeddings.
     *
     * - For OpenAI: e.g. `'text-embedding-3-small'`, `'text-embedding-3-large'`
     * - For HuggingFace: e.g. `'BAAI/bge-base-en-v1.5'`
     * - For Ollama: e.g. `'nomic-embed-text'`
     */
    model?: string;
    /**
     * @description
     * API key for the embedder provider (required for OpenAI, optional for others).
     */
    apiKey?: string;
    /**
     * @description
     * URL of the embedder API (required for `rest` and `ollama` sources).
     */
    url?: string;
    /**
     * @description
     * A Liquid template that renders each document into text for embedding.
     * Use `{{doc.fieldName}}` to interpolate document fields.
     *
     * Keep templates short (15-45 words) and include only the most relevant fields.
     *
     * @example
     * ```
     * "A product called '{{doc.productName}}' - {{doc.description | truncatewords: 20}}"
     * ```
     */
    documentTemplate?: string;
    /**
     * @description
     * Maximum byte length of the rendered document template. Defaults to 400.
     */
    documentTemplateMaxBytes?: number;
    /**
     * @description
     * The dimensions of the embeddings. Required for `userProvided` source.
     * For other sources, this is usually inferred from the model.
     */
    dimensions?: number;
    /**
     * @description
     * Custom request structure for `rest` source embedders.
     */
    request?: Record<string, any>;
    /**
     * @description
     * Custom response structure for `rest` source embedders.
     */
    response?: Record<string, any>;
    /**
     * @description
     * Additional headers for `rest` source embedders.
     */
    headers?: Record<string, string>;
}

/**
 * @description
 * Configuration for typo tolerance behavior.
 */
export interface TypoToleranceConfig {
    /**
     * @description
     * Whether typo tolerance is enabled. Defaults to `true`.
     */
    enabled?: boolean;
    /**
     * @description
     * Minimum word size for 1 typo to be allowed. Defaults to 5.
     */
    minWordSizeForOneTypo?: number;
    /**
     * @description
     * Minimum word size for 2 typos to be allowed. Defaults to 9.
     */
    minWordSizeForTwoTypos?: number;
    /**
     * @description
     * A list of words for which typo tolerance is disabled.
     * Useful for brand names or technical terms that must be exact.
     *
     * @example
     * ```ts
     * ['iPhone', 'Samsung', 'MacBook']
     * ```
     */
    disableOnWords?: string[];
    /**
     * @description
     * A list of attributes for which typo tolerance is disabled.
     *
     * @example
     * ```ts
     * ['sku']  // SKU must match exactly
     * ```
     */
    disableOnAttributes?: string[];
}

/**
 * @description
 * Configuration options for the MeilisearchPlugin.
 *
 * @example
 * ```ts
 * // Basic setup (full-text search only)
 * MeilisearchPlugin.init({
 *   host: 'http://localhost:7700',
 *   apiKey: 'masterKey',
 * })
 *
 * // With AI-powered hybrid search
 * MeilisearchPlugin.init({
 *   host: 'http://localhost:7700',
 *   apiKey: 'masterKey',
 *   ai: {
 *     embedders: {
 *       'product-search': {
 *         source: 'openAi',
 *         model: 'text-embedding-3-small',
 *         apiKey: process.env.OPENAI_API_KEY,
 *         documentTemplate: "A product called '{{doc.productName}}' - {{doc.description | truncatewords: 20}}",
 *       },
 *     },
 *   },
 *   synonyms: {
 *     phone: ['mobile', 'smartphone'],
 *     laptop: ['notebook'],
 *   },
 * })
 * ```
 *
 * @docsCategory MeilisearchPlugin
 */
export interface MeilisearchOptions {
    /**
     * @description
     * The host URL of the Meilisearch server.
     *
     * @default 'http://localhost:7700'
     */
    host?: string;
    /**
     * @description
     * The API key for the Meilisearch server.
     * This is the master key or admin key used for indexing operations.
     *
     * @default ''
     */
    apiKey?: string;
    /**
     * @description
     * Maximum amount of attempts made to connect to the Meilisearch server on startup.
     *
     * @default 10
     */
    connectionAttempts?: number;
    /**
     * @description
     * Interval in milliseconds between attempts to connect to the Meilisearch server on startup.
     *
     * @default 5000
     */
    connectionAttemptInterval?: number;
    /**
     * @description
     * Prefix for the indices created by the plugin.
     *
     * @default 'vendure-'
     */
    indexPrefix?: string;
    /**
     * @description
     * Products limit chunk size for each loop iteration when indexing products.
     *
     * @default 2500
     */
    reindexProductsChunkSize?: number;
    /**
     * @description
     * Batch size for document additions during reindexing.
     * Meilisearch handles documents in batches for optimal performance.
     *
     * @default 1000
     */
    reindexBatchSize?: number;
    /**
     * @description
     * Configuration of the internal Meilisearch search query.
     */
    searchConfig?: SearchConfig;
    /**
     * @description
     * Custom product mappings for additional data in the search index.
     */
    customProductMappings?: {
        [fieldName: string]: CustomMapping<
            [Product, ProductVariant[], LanguageCode, Injector, RequestContext]
        >;
    };
    /**
     * @description
     * Custom product variant mappings for additional data in the search index.
     */
    customProductVariantMappings?: {
        [fieldName: string]: CustomMapping<[ProductVariant, LanguageCode, Injector, RequestContext]>;
    };
    /**
     * @description
     * If set to `true`, updates to Products, ProductVariants and Collections will not immediately
     * trigger an update to the search index. Instead, all these changes will be buffered and will
     * only be run via a call to the `runPendingSearchIndexUpdates` mutation in the Admin API.
     *
     * @default false
     */
    bufferUpdates?: boolean;
    /**
     * @description
     * Additional product relations that will be fetched from DB while reindexing.
     *
     * @default []
     */
    hydrateProductRelations?: Array<EntityRelationPaths<Product>>;
    /**
     * @description
     * Additional variant relations that will be fetched from DB while reindexing.
     *
     * @default []
     */
    hydrateProductVariantRelations?: Array<EntityRelationPaths<ProductVariant>>;
    /**
     * @description
     * Allows the `SearchInput` type to be extended with new input fields.
     *
     * @default {}
     */
    extendSearchInputType?: {
        [name: string]: PrimitiveTypeVariations<GraphQlPrimitive>;
    };
    /**
     * @description
     * Adds a list of sort parameters.
     *
     * @default []
     */
    extendSearchSortType?: string[];

    // ───────────────────────────── AI / Hybrid Search ─────────────────────────────

    /**
     * @description
     * AI-powered search configuration. When set, enables hybrid search
     * that combines full-text keyword matching with semantic vector search.
     *
     * Requires an embedding provider (OpenAI, HuggingFace, Ollama, etc.).
     * This is entirely **opt-in** - if not configured, the plugin operates
     * in full-text search mode only.
     *
     * @example
     * ```ts
     * ai: {
     *   embedders: {
     *     'default': {
     *       source: 'openAi',
     *       model: 'text-embedding-3-small',
     *       apiKey: process.env.OPENAI_API_KEY,
     *       documentTemplate: "A product called '{{doc.productName}}' - {{doc.description | truncatewords: 20}}",
     *     },
     *   },
     *   defaultEmbedder: 'default',
     *   semanticRatio: 0.5,
     * }
     * ```
     *
     * @default undefined (AI search disabled)
     */
    ai?: AiSearchConfig;

    // ───────────────────────────── Relevancy Tuning ─────────────────────────────

    /**
     * @description
     * A map of synonyms. Each key is a word, and its value is an array of
     * synonymous words. This allows users to find products regardless of
     * which synonym they use.
     *
     * @example
     * ```ts
     * synonyms: {
     *   phone: ['mobile', 'smartphone', 'cellphone'],
     *   laptop: ['notebook', 'portable computer'],
     *   tv: ['television', 'monitor', 'screen'],
     * }
     * ```
     *
     * @default undefined (no synonyms)
     */
    synonyms?: Record<string, string[]>;

    /**
     * @description
     * A list of words to ignore during search. Common stop words like
     * "the", "a", "is" can be filtered out for cleaner results.
     *
     * @example
     * ```ts
     * stopWords: ['the', 'a', 'an', 'is', 'for', 'and', 'of', 'to', 'in']
     * ```
     *
     * @default undefined (no stop words)
     */
    stopWords?: string[];

    /**
     * @description
     * Custom ranking rules for controlling how search results are ordered.
     * Meilisearch applies these rules in order using a bucket sort algorithm -
     * the first rule has the most impact.
     *
     * Built-in rules: `'words'`, `'typo'`, `'proximity'`, `'attribute'`, `'sort'`, `'exactness'`
     *
     * You can also add custom ranking rules using attribute names followed by `:asc` or `:desc`.
     *
     * @example
     * ```ts
     * // Prioritize in-stock products, then sort by price
     * rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'productInStock:desc']
     * ```
     *
     * @default undefined (Meilisearch defaults)
     */
    rankingRules?: string[];

    /**
     * @description
     * Configuration for typo tolerance. Allows you to control how Meilisearch
     * handles misspellings in search queries.
     *
     * @example
     * ```ts
     * typoTolerance: {
     *   enabled: true,
     *   disableOnAttributes: ['sku'],  // SKU must match exactly
     *   disableOnWords: ['iPhone'],     // Brand names must be exact
     *   minWordSizeForOneTypo: 4,
     *   minWordSizeForTwoTypos: 8,
     * }
     * ```
     *
     * @default undefined (Meilisearch defaults: typo tolerance enabled)
     */
    typoTolerance?: TypoToleranceConfig;
}

/**
 * @description
 * Configuration for AI-powered hybrid search.
 */
export interface AiSearchConfig {
    /**
     * @description
     * A map of embedder configurations. You can define multiple embedders
     * for different use cases. At minimum, define one.
     *
     * The key is the embedder name, which is referenced when performing
     * hybrid searches.
     */
    embedders: Record<string, EmbedderConfig>;
    /**
     * @description
     * The name of the default embedder to use for hybrid search.
     * Must match a key in the `embedders` map.
     *
     * @default The first key in `embedders`
     */
    defaultEmbedder?: string;
    /**
     * @description
     * Controls the balance between full-text and semantic results.
     *
     * - `0.0` = pure full-text search (keywords only)
     * - `0.5` = equal mix of full-text and semantic (recommended starting point)
     * - `1.0` = pure semantic search (meaning only)
     *
     * @default 0.5
     */
    semanticRatio?: number;
}

/**
 * @description
 * Configuration options for the internal Meilisearch query generated when performing a search.
 */
export interface SearchConfig {
    /**
     * @description
     * The maximum number of FacetValues to return from the search query.
     *
     * @default 50
     */
    facetValueMaxSize?: number;
    /**
     * @description
     * The maximum number of Collections to return from the search query.
     *
     * @default 50
     */
    collectionMaxSize?: number;
    /**
     * @description
     * The maximum number of totalItems to return from the search query.
     *
     * @default 10000
     */
    totalItemsMaxSize?: number;
    /**
     * @description
     * The interval used to group search results into price range buckets.
     *
     * @default 1000
     */
    priceRangeBucketInterval?: number;
    /**
     * @description
     * Allows modification of the whole search query before it is sent to Meilisearch.
     */
    mapQuery?: (
        query: any,
        input: MeilisearchSearchInput,
        searchConfig: DeepRequired<SearchConfig>,
        channelId: ID,
        enabledOnly: boolean,
        ctx: RequestContext,
    ) => any;
    /**
     * @description
     * Allows extending the sort parameter of the Meilisearch query.
     */
    mapSort?: (sort: string[], input: MeilisearchSearchInput) => string[];
}

export type MeilisearchRuntimeOptions = DeepRequired<
    Omit<MeilisearchOptions, 'ai' | 'synonyms' | 'stopWords' | 'rankingRules' | 'typoTolerance'>
> & {
    ai?: AiSearchConfig;
    synonyms?: Record<string, string[]>;
    stopWords?: string[];
    rankingRules?: string[];
    typoTolerance?: TypoToleranceConfig;
};

export const defaultOptions: MeilisearchRuntimeOptions = {
    host: 'http://localhost:7700',
    apiKey: '',
    connectionAttempts: 10,
    connectionAttemptInterval: 5000,
    indexPrefix: 'vendure-',
    reindexProductsChunkSize: 2500,
    reindexBatchSize: 1000,
    searchConfig: {
        facetValueMaxSize: 50,
        collectionMaxSize: 50,
        totalItemsMaxSize: 10000,
        priceRangeBucketInterval: 1000,
        mapQuery: query => query,
        mapSort: sort => sort,
    },
    customProductMappings: {},
    customProductVariantMappings: {},
    bufferUpdates: false,
    hydrateProductRelations: [],
    hydrateProductVariantRelations: [],
    extendSearchInputType: {},
    extendSearchSortType: [],
};

export function mergeWithDefaults(userOptions: MeilisearchOptions): MeilisearchRuntimeOptions {
    const { ai, synonyms, stopWords, rankingRules, typoTolerance, ...rest } = userOptions;
    const merged = deepmerge(defaultOptions, rest) as MeilisearchRuntimeOptions;
    // These optional configs are not deep-merged to avoid weird array merging behavior
    if (ai) merged.ai = ai;
    if (synonyms) merged.synonyms = synonyms;
    if (stopWords) merged.stopWords = stopWords;
    if (rankingRules) merged.rankingRules = rankingRules;
    if (typoTolerance) merged.typoTolerance = typoTolerance;
    return merged;
}
