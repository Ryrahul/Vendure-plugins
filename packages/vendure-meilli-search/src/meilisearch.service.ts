import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SearchResultAsset } from '@vendure/common/lib/generated-types';
import {
    Collection,
    CollectionService,
    ConfigService,
    DeepRequired,
    EventBus,
    FacetValue,
    FacetValueService,
    ID,
    InternalServerError,
    Job,
    Logger,
    RequestContext,
    SearchEvent,
    SearchService,
    UserInputError,
} from '@vendure/core';
import { Index, MeiliSearch } from 'meilisearch';

import { buildFilter, buildSort, escapeFilterValue } from './build-search-query';

import { MEILISEARCH_OPTIONS, loggerCtx, VARIANT_INDEX_NAME } from './constants';
import { getClient, getIndexUid, createIndex, configureIndex } from './indexing/indexing-utils';
import { MeilisearchIndexService } from './indexing/meilisearch-index.service';
import { MeilisearchRuntimeOptions } from './options';
import {
    CustomMapping,
    MeilisearchSearchInput,
    MeilisearchSearchResponse,
    MeilisearchQueryParams,
    MeilisearchSearchResult,
    ProductIndexItem,
    SearchPriceData,
    SimilarDocumentsInput,
    VariantIndexItem,
} from './types';

@Injectable()
export class MeilisearchService implements OnModuleInit, OnModuleDestroy {
    private client: MeiliSearch;

    constructor(
        @Inject(MEILISEARCH_OPTIONS) private options: MeilisearchRuntimeOptions,
        private searchService: SearchService,
        private meilisearchIndexService: MeilisearchIndexService,
        private configService: ConfigService,
        private facetValueService: FacetValueService,
        private collectionService: CollectionService,
        private eventBus: EventBus,
    ) {
        searchService.adopt(this);
    }

    onModuleInit(): any {
        // The MeiliSearch JS client is stateless — it wraps fetch with config
        // and does not maintain connection pools or persistent connections.
        // A separate instance in MeilisearchIndexerController is intentional:
        // each service owns its own client for clarity and lifecycle isolation.
        this.client = getClient(this.options);
    }

    onModuleDestroy(): any {
        // MeiliSearch JS client has no close/cleanup method
    }

    /**
     * Extracts the total hit count from a Meilisearch search result,
     * handling both `estimatedTotalHits` and `totalHits` response fields.
     */
    private getTotalHitCount(result: any): number {
        return result.estimatedTotalHits || result.totalHits || 0;
    }

    async checkConnection(): Promise<void> {
        const { connectionAttempts, connectionAttemptInterval } = this.options;
        let attempts = 0;
        Logger.verbose('Pinging Meilisearch...', loggerCtx);
        while (attempts < connectionAttempts) {
            attempts++;
            try {
                const health = await this.client.health();
                if (health.status === 'available') {
                    Logger.verbose('Ping to Meilisearch successful', loggerCtx);
                    return;
                }
            } catch (e: any) {
                Logger.verbose(
                    `Ping to Meilisearch failed with error "${e.message as string}"`,
                    loggerCtx,
                );
            }
            Logger.verbose(
                `Connection to Meilisearch could not be made, trying again after ${connectionAttemptInterval}ms (attempt ${attempts} of ${connectionAttempts})`,
                loggerCtx,
            );
            await new Promise(resolve1 => setTimeout(resolve1, connectionAttemptInterval));
        }
        throw new Error('Could not connect to Meilisearch. Aborting bootstrap.');
    }

    /**
     * Single health ping without retry loop. Used by the health check indicator
     * to fail fast instead of blocking for up to connectionAttempts × connectionAttemptInterval.
     */
    async ping(): Promise<boolean> {
        const health = await this.client.health();
        return health.status === 'available';
    }

    async createIndicesIfNotExists(): Promise<void> {
        const indexUid = getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME);
        try {
            await this.client.getIndex(indexUid);
            Logger.verbose(`Index "${indexUid}" exists`, loggerCtx);
        } catch (e: any) {
            Logger.verbose(`Index "${indexUid}" does not exist. Creating...`, loggerCtx);
            await createIndex(this.client, indexUid, 'id', this.options);
            await configureIndex(this.client, indexUid, this.options);
        }
    }

    /**
     * @description
     * Returns `true` if Meilisearch AI (hybrid/vector) search is configured.
     */
    get isAiSearchEnabled(): boolean {
        return !!(this.options.ai?.embedders && Object.keys(this.options.ai.embedders).length > 0);
    }

    /**
     * @description
     * Returns the default embedder name from the AI config.
     */
    get defaultEmbedderName(): string | undefined {
        if (!this.options.ai) return undefined;
        return this.options.ai.defaultEmbedder || Object.keys(this.options.ai.embedders)[0];
    }

    /**
     * The hybrid search parameters to apply to every query when AI search is
     * configured, or `undefined` when it is not.
     */
    private getHybridParams(): { embedder: string; semanticRatio: number } | undefined {
        if (!this.isAiSearchEnabled || !this.defaultEmbedderName) {
            return undefined;
        }
        return {
            embedder: this.defaultEmbedderName,
            semanticRatio: this.options.ai?.semanticRatio ?? 0.5,
        };
    }

    /**
     * Runs a search, falling back to a keyword-only search if Meilisearch reports that
     * the configured embedder is unavailable.
     *
     * During a reindex, the index swap briefly leaves the primary index without embedder
     * settings, and a hybrid search arriving in that window is rejected. Falling back
     * keeps the request serving results; the embedder settings are restored once the swap
     * completes and subsequent searches use hybrid search again automatically.
     *
     * The fallback is logged at `warn` because the same error is raised by a genuinely
     * misconfigured embedder, where every search silently degrades to keyword search — a
     * repeating warning is the signal that AI search is not actually working.
     */
    private async searchWithHybridFallback(
        index: Index,
        term: string,
        params: MeilisearchQueryParams,
    ): Promise<any> {
        try {
            return await index.search(term, params);
        } catch (e: any) {
            if (e.message?.includes('Cannot find embedder') && params.hybrid) {
                Logger.warn(
                    `Embedder "${params.hybrid.embedder as string}" is not available on index ` +
                        `"${index.uid}"; falling back to keyword search. If this persists outside of a ` +
                        'reindex, check the `ai.embedders` configuration.',
                    loggerCtx,
                );
                const { hybrid, ...paramsWithoutHybrid } = params;
                return index.search(term, paramsWithoutHybrid);
            }
            throw e;
        }
    }

    /**
     * Perform a fulltext search according to the provided input arguments.
     */
    async search(
        ctx: RequestContext,
        input: MeilisearchSearchInput,
        enabledOnly: boolean = false,
    ): Promise<Omit<MeilisearchSearchResponse, 'facetValues' | 'collections' | 'priceRange'>> {
        const { groupByProduct, groupBySKU } = input;
        const indexUid = getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME);
        const index = this.client.index(indexUid);

        if (groupByProduct && groupBySKU) {
            throw new InternalServerError(
                'Cannot use both groupByProduct and groupBySKU simultaneously. Please set only one of these options to true.',
            );
        }

        const filter = buildFilter(ctx, input, enabledOnly);
        const sort = buildSort(input, this.options);
        const offset = input.skip || 0;
        const limit = input.take || 10;

        const searchParams: MeilisearchQueryParams = {
            filter,
            sort,
            offset,
            limit,
        };

        if (groupByProduct) {
            searchParams.distinct = 'productId';
        } else if (groupBySKU) {
            searchParams.distinct = 'sku';
        }

        // If AI search is enabled, automatically add hybrid search params
        searchParams.hybrid = this.getHybridParams();

        // Apply query-time search config options from plugin configuration
        const sc = this.options.searchConfig;
        if (sc.matchingStrategy) {
            searchParams.matchingStrategy = sc.matchingStrategy;
        }
        if (sc.attributesToSearchOn) {
            searchParams.attributesToSearchOn = sc.attributesToSearchOn;
        }
        if (sc.attributesToRetrieve) {
            searchParams.attributesToRetrieve = sc.attributesToRetrieve;
        }
        if (sc.rankingScoreThreshold !== undefined) {
            searchParams.rankingScoreThreshold = sc.rankingScoreThreshold;
        }
        if (sc.attributesToHighlight) {
            searchParams.attributesToHighlight = sc.attributesToHighlight;
        }
        if (sc.highlightPreTag) {
            searchParams.highlightPreTag = sc.highlightPreTag;
        }
        if (sc.highlightPostTag) {
            searchParams.highlightPostTag = sc.highlightPostTag;
        }
        if (sc.attributesToCrop) {
            searchParams.attributesToCrop = sc.attributesToCrop;
        }
        if (sc.cropLength !== undefined) {
            searchParams.cropLength = sc.cropLength;
        }
        if (sc.cropMarker !== undefined) {
            searchParams.cropMarker = sc.cropMarker;
        }
        if (sc.showMatchesPosition) {
            searchParams.showMatchesPosition = sc.showMatchesPosition;
        }
        if (sc.showRankingScore) {
            searchParams.showRankingScore = sc.showRankingScore;
        }
        if (sc.showRankingScoreDetails) {
            searchParams.showRankingScoreDetails = sc.showRankingScoreDetails;
        }

        // Apply mapQuery if configured
        const finalParams = this.options.searchConfig.mapQuery
            ? this.options.searchConfig.mapQuery(
                  searchParams,
                  input,
                  this.options.searchConfig,
                  ctx.channelId,
                  enabledOnly,
                  ctx,
              )
            : searchParams;

        try {
            const result = await this.searchWithHybridFallback(index, input.term || '', finalParams);
            await this.eventBus.publish(new SearchEvent(ctx, input));

            if (groupByProduct || groupBySKU) {
                const totalItems = await this.totalHits(ctx, input, enabledOnly);
                return {
                    items: result.hits.map((hit: any) =>
                        this.mapProductToSearchResult(hit, groupByProduct ?? false, groupBySKU ?? false),
                    ),
                    totalItems,
                };
            } else {
                return {
                    items: result.hits.map((hit: any) => this.mapVariantToSearchResult(hit)),
                    totalItems: this.getTotalHitCount(result),
                };
            }
        } catch (e: any) {
            Logger.error(e.message, loggerCtx, e.stack);
            throw e;
        }
    }

    async totalHits(
        ctx: RequestContext,
        input: MeilisearchSearchInput,
        enabledOnly: boolean = false,
    ): Promise<number> {
        const indexUid = getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME);
        const index = this.client.index(indexUid);
        const { groupByProduct, groupBySKU } = input;

        const filter = buildFilter(ctx, input, enabledOnly);

        // Page-based pagination (`page`/`hitsPerPage`) makes Meilisearch return an
        // exhaustive `totalHits` that accounts for `distinct`, unlike the
        // `estimatedTotalHits` returned for offset/limit queries, which counts hits
        // before deduplication. The count is bounded by the index's
        // `pagination.maxTotalHits`, which configureIndex derives from
        // `searchConfig.totalItemsMaxSize`.
        const searchParams: MeilisearchQueryParams = {
            filter,
            page: 1,
            hitsPerPage: 1,
            // The count must be taken over the same result set the search itself returns.
            // Counting without the hybrid params would report the keyword-only match count,
            // which is 0 for a purely semantic query that nonetheless returns items.
            hybrid: this.getHybridParams(),
        };
        if (groupByProduct) {
            searchParams.distinct = 'productId';
        } else if (groupBySKU) {
            searchParams.distinct = 'sku';
        }

        try {
            const result = await this.searchWithHybridFallback(index, input.term || '', searchParams);
            return (result as any).totalHits ?? this.getTotalHitCount(result);
        } catch (e: any) {
            Logger.error(e.message, loggerCtx, e.stack);
            return 0;
        }
    }

    /**
     * Return a list of all FacetValues which appear in the result set.
     */
    async facetValues(
        ctx: RequestContext,
        input: MeilisearchSearchInput,
        enabledOnly: boolean = false,
    ): Promise<Array<{ facetValue: FacetValue; count: number }>> {
        const indexUid = getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME);
        const index = this.client.index(indexUid);
        const filter = buildFilter(ctx, input, enabledOnly);

        try {
            const { groupByProduct } = input;
            // When grouped by product, use productFacetValueIds to get per-product counts
            const facetField = groupByProduct ? 'productFacetValueIds' : 'facetValueIds';
            const searchParams: MeilisearchQueryParams = {
                filter,
                offset: 0,
                limit: 0,
                facets: [facetField],
            };
            if (groupByProduct) {
                searchParams.distinct = 'productId';
            }
            const result = await index.search(input.term || '', searchParams);

            const facetDistribution = result.facetDistribution?.[facetField] || {};
            const facetValueIds = Object.keys(facetDistribution).slice(
                0,
                this.options.searchConfig.facetValueMaxSize,
            );

            if (facetValueIds.length === 0) {
                return [];
            }

            const facetValues = await this.facetValueService.findByIds(ctx, facetValueIds);
            return facetValues.map(facetValue => {
                const count = facetDistribution[facetValue.id.toString()] || 0;
                return { facetValue, count };
            });
        } catch (e: any) {
            Logger.error(e.message, loggerCtx, e.stack);
            return [];
        }
    }

    /**
     * Return a list of all Collections which appear in the result set.
     */
    async collections(
        ctx: RequestContext,
        input: MeilisearchSearchInput,
        enabledOnly: boolean = false,
    ): Promise<Array<{ collection: Collection; count: number }>> {
        const indexUid = getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME);
        const index = this.client.index(indexUid);
        const filter = buildFilter(ctx, input, enabledOnly);

        try {
            const { groupByProduct } = input;
            // When grouped by product, use productCollectionIds to get per-product counts
            const collectionField = groupByProduct ? 'productCollectionIds' : 'collectionIds';
            const searchParams: MeilisearchQueryParams = {
                filter,
                offset: 0,
                limit: 0,
                facets: [collectionField],
            };
            if (groupByProduct) {
                searchParams.distinct = 'productId';
            }
            const result = await index.search(input.term || '', searchParams);

            const collectionDistribution = result.facetDistribution?.[collectionField] || {};
            const collectionIds = Object.keys(collectionDistribution).slice(
                0,
                this.options.searchConfig.collectionMaxSize,
            );

            if (collectionIds.length === 0) {
                return [];
            }

            const collections = await this.collectionService.findByIds(ctx, collectionIds);
            return collections.map(collection => {
                const count = collectionDistribution[collection.id.toString()] || 0;
                return { collection, count };
            });
        } catch (e: any) {
            Logger.error(e.message, loggerCtx, e.stack);
            return [];
        }
    }

    async priceRange(ctx: RequestContext, input: MeilisearchSearchInput): Promise<SearchPriceData> {
        const indexUid = getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME);
        const index = this.client.index(indexUid);
        const filter = buildFilter(ctx, input, true);

        try {
            const result = await index.search(input.term || '', {
                filter,
                offset: 0,
                limit: 0,
                facets: ['price', 'priceWithTax'],
            });

            const facetStats = result.facetStats || {};
            const priceStats = facetStats.price || { min: 0, max: 0 };
            const priceWithTaxStats = facetStats.priceWithTax || { min: 0, max: 0 };

            const bucketInterval = this.options.searchConfig.priceRangeBucketInterval;

            // Generate price buckets by searching with filter ranges
            const buckets = await this.generatePriceBuckets(
                index,
                input.term || '',
                filter,
                'price',
                priceStats.min,
                priceStats.max,
                bucketInterval,
            );

            const bucketsWithTax = await this.generatePriceBuckets(
                index,
                input.term || '',
                filter,
                'priceWithTax',
                priceWithTaxStats.min,
                priceWithTaxStats.max,
                bucketInterval,
            );

            return {
                range: {
                    min: Math.round(priceStats.min) || 0,
                    max: Math.round(priceStats.max) || 0,
                },
                rangeWithTax: {
                    min: Math.round(priceWithTaxStats.min) || 0,
                    max: Math.round(priceWithTaxStats.max) || 0,
                },
                buckets,
                bucketsWithTax,
            };
        } catch (e: any) {
            Logger.error(e.message, loggerCtx, e.stack);
            throw new InternalServerError(
                'An error occurred when querying Meilisearch for priceRange data',
            );
        }
    }

    /**
     * Rebuilds the full search index.
     */
    async reindex(ctx: RequestContext): Promise<Job> {
        const job = await this.meilisearchIndexService.reindex(ctx);
        return job;
    }

    /**
     * @description
     * Retrieves documents similar to the given document ID using Meilisearch's
     * vector search. Requires AI search to be configured.
     *
     * Useful for "More like this", "Customers also viewed", or product recommendations.
     *
     * Results are always scoped to the current channel and language — without that the
     * index would happily return documents belonging to other channels — and, on the
     * Shop API, to enabled products only.
     *
     * Throws rather than returning an empty result set, so that a misconfiguration
     * surfaces as an error the storefront can branch on instead of a silently
     * empty carousel.
     */
    async similarDocuments(
        ctx: RequestContext,
        input: SimilarDocumentsInput,
    ): Promise<{ items: MeilisearchSearchResult[]; totalItems: number }> {
        if (!this.isAiSearchEnabled) {
            throw new UserInputError(
                'The `similarDocuments` query requires AI search. Configure `ai.embedders` in the MeilisearchPlugin options.',
            );
        }

        const indexUid = getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME);
        const index = this.client.index(indexUid);
        const embedder = input.embedder || this.defaultEmbedderName!;
        const configuredEmbedders = Object.keys(this.options.ai?.embedders ?? {});
        if (!configuredEmbedders.includes(embedder)) {
            throw new UserInputError(
                `Unknown embedder "${embedder}". Configured embedders: ${configuredEmbedders.join(', ')}.`,
            );
        }

        const filterParts = [
            `channelId = "${escapeFilterValue(ctx.channelId)}"`,
            `languageCode = "${escapeFilterValue(ctx.languageCode)}"`,
        ];
        if (ctx.apiType === 'shop') {
            filterParts.push('enabled = true');
        }
        if (input.filter) {
            // Caller-supplied Meilisearch filter expression, parenthesised so that its
            // own OR clauses cannot escape the channel/language scoping above.
            filterParts.push(`(${input.filter})`);
        }

        const limit = input.limit || 10;
        // `searchSimilarDocuments` has no `distinct` parameter, so grouping by product is
        // done here: over-fetch, collapse variants of the same product, then trim.
        const overFetchFactor = 5;
        const fetchLimit = input.groupByProduct ? Math.min(limit * overFetchFactor, 200) : limit;

        try {
            const result = await index.searchSimilarDocuments({
                id: input.id,
                embedder,
                limit: fetchLimit,
                offset: input.offset || 0,
                filter: filterParts.join(' AND '),
                ...(this.options.searchConfig.rankingScoreThreshold !== undefined
                    ? { rankingScoreThreshold: this.options.searchConfig.rankingScoreThreshold }
                    : {}),
            });

            let hits = result.hits;
            if (input.groupByProduct) {
                const seen = new Set<string>();
                hits = hits.filter((hit: any) => {
                    const productId = String(hit.productId);
                    if (seen.has(productId)) {
                        return false;
                    }
                    seen.add(productId);
                    return true;
                });
            }
            hits = hits.slice(0, limit);

            return {
                items: hits.map((hit: any) =>
                    input.groupByProduct
                        ? this.mapProductToSearchResult(hit, true, false)
                        : this.mapVariantToSearchResult(hit),
                ),
                // Vector search ranks every document in the filtered set, so the total is
                // the size of that set rather than a count of "similar enough" documents.
                // Set `searchConfig.rankingScoreThreshold` to cut off weak matches.
                totalItems: this.getTotalHitCount(result) || hits.length,
            };
        } catch (e: any) {
            Logger.error(`Error fetching similar documents: ${e.message as string}`, loggerCtx, e.stack);
            throw new InternalServerError(
                'An error occurred when querying Meilisearch for similar documents',
            );
        }
    }

    private async generatePriceBuckets(
        index: any,
        term: string,
        baseFilter: string,
        field: string,
        min: number,
        max: number,
        interval: number,
    ): Promise<Array<{ to: number; count: number }>> {
        if (min === 0 && max === 0) {
            return [];
        }

        // Build all bucket ranges upfront
        const ranges: Array<{ start: number; end: number }> = [];
        let bucketStart = Math.floor(min / interval) * interval;
        while (bucketStart <= max) {
            ranges.push({ start: bucketStart, end: bucketStart + interval });
            bucketStart += interval;
        }

        // Execute in parallel batches with a concurrency cap to avoid
        // overwhelming Meilisearch with too many simultaneous requests
        const CONCURRENCY = 10;
        const buckets: Array<{ to: number; count: number }> = [];

        for (let i = 0; i < ranges.length; i += CONCURRENCY) {
            const batch = ranges.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
                batch.map(async ({ start, end }) => {
                    const bucketFilter = baseFilter
                        ? `${baseFilter} AND ${field} >= ${start} AND ${field} < ${end}`
                        : `${field} >= ${start} AND ${field} < ${end}`;
                    try {
                        const result = await index.search(term, {
                            filter: bucketFilter,
                            offset: 0,
                            limit: 0,
                        });
                        const count = this.getTotalHitCount(result);
                        return count > 0 ? { to: end, count } : null;
                    } catch (e: any) {
                        Logger.warn(`Error generating price bucket for range ${start}-${end}: ${e.message}`, loggerCtx);
                        return null;
                    }
                }),
            );
            for (const r of results) {
                if (r) {
                    buckets.push(r);
                }
            }
        }

        return buckets;
    }

    private mapVariantToSearchResult(hit: any): MeilisearchSearchResult {
        const source: VariantIndexItem = hit;
        const { productAsset, productVariantAsset } = this.getSearchResultAssets(source);
        const result: any = {
            ...source,
            productAsset,
            productVariantAsset,
            price: {
                value: source.price,
            },
            priceWithTax: {
                value: source.priceWithTax,
            },
            score: (hit)._rankingScore || 0,
            formattedProductName: hit._formatted?.productName ?? null,
            formattedDescription: hit._formatted?.description ?? null,
        };

        MeilisearchService.addCustomMappings(
            result,
            source,
            this.options.customProductMappings,
            this.options.customProductVariantMappings,
            false,
            false,
        );
        return result;
    }

    private mapProductToSearchResult(
        hit: any,
        groupByProduct: boolean = false,
        groupBySKU: boolean = false,
    ): MeilisearchSearchResult {
        const source: VariantIndexItem = hit;
        const { productAsset, productVariantAsset } = this.getSearchResultAssets(source);
        const result: any = {
            ...source,
            productAsset,
            productVariantAsset,
            enabled: source.productEnabled,
            productId: source.productId.toString(),
            productName: source.productName,
            productVariantId: source.productVariantId.toString(),
            productVariantName: source.productVariantName,
            facetIds: source.productFacetIds as string[],
            facetValueIds: source.productFacetValueIds as string[],
            collectionIds: source.productCollectionIds as string[],
            sku: source.sku,
            slug: source.slug,
            price: {
                min: source.productPriceMin,
                max: source.productPriceMax,
            },
            priceWithTax: {
                min: source.productPriceWithTaxMin,
                max: source.productPriceWithTaxMax,
            },
            channelIds: [],
            inStock: source.productInStock,
            score: (hit)._rankingScore || 0,
            formattedProductName: hit._formatted?.productName ?? null,
            formattedDescription: hit._formatted?.description ?? null,
        };
        MeilisearchService.addCustomMappings(
            result,
            source,
            this.options.customProductMappings,
            this.options.customProductVariantMappings,
            groupByProduct,
            groupBySKU,
        );
        return result;
    }

    private getSearchResultAssets(source: ProductIndexItem | VariantIndexItem): {
        productAsset: SearchResultAsset | undefined;
        productVariantAsset: SearchResultAsset | undefined;
    } {
        const productAsset: SearchResultAsset | undefined = source.productAssetId
            ? {
                  id: source.productAssetId.toString(),
                  preview: source.productPreview,
                  focalPoint: source.productPreviewFocalPoint,
              }
            : undefined;
        const productVariantAsset: SearchResultAsset | undefined = source.productVariantAssetId
            ? {
                  id: source.productVariantAssetId.toString(),
                  preview: source.productVariantPreview,
                  focalPoint: source.productVariantPreviewFocalPoint,
              }
            : undefined;
        return { productAsset, productVariantAsset };
    }

    private static addCustomMappings(
        result: any,
        source: any,
        productMappings: { [fieldName: string]: CustomMapping<any> },
        variantMappings: { [fieldName: string]: CustomMapping<any> },
        groupByProduct: boolean,
        groupBySKU: boolean,
    ): any {
        const productCustomMappings = Object.keys(productMappings);
        if (productCustomMappings.length) {
            const customMappingsResult: any = {};
            for (const name of productCustomMappings) {
                customMappingsResult[name] = source[`product-${name}`];
            }
            result.customProductMappings = customMappingsResult;
            if (groupByProduct || groupBySKU) {
                result.customMappings = customMappingsResult;
            }
        }
        const variantCustomMappings = Object.keys(variantMappings);
        if (variantCustomMappings.length) {
            const customMappingsResult: any = {};
            for (const name of variantCustomMappings) {
                customMappingsResult[name] = source[`variant-${name}`];
            }
            result.customProductVariantMappings = customMappingsResult;
            if (!groupByProduct && !groupBySKU) {
                result.customMappings = customMappingsResult;
            }
        }
        return result;
    }
}
