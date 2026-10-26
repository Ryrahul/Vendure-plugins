/**
 * Elasticsearch support: `@rahul_vendure/vendure-plugin-channel-product-availability/elasticsearch`.
 *
 * A separate entry point, so projects without `@vendure-community/elasticsearch-plugin` never
 * load it. Tested with the Elasticsearch plugin 1.1.0 and 2.0.0.
 *
 * @example
 * ```ts
 * import {
 *     ChannelAvailabilityElasticsearchPlugin,
 *     withChannelAvailability,
 * } from '@rahul_vendure/vendure-plugin-channel-product-availability/elasticsearch';
 *
 * plugins: [
 *     ElasticsearchPlugin.init(withChannelAvailability({ host: 'http://localhost', port: 9200 })),
 *     ChannelProductAvailabilityPlugin.init({ syncDefaultSearchIndex: false }),
 *     ChannelAvailabilityElasticsearchPlugin,
 * ]
 * ```
 *
 * Run a full reindex after installing, so every document gets the per-channel field.
 */
import { OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { ElasticsearchOptions } from '@vendure-community/elasticsearch-plugin';
import { ElasticsearchIndexService } from '@vendure-community/elasticsearch-plugin/lib/src/indexing/elasticsearch-index.service';
import {
    EventBus,
    ID,
    Injector,
    LanguageCode,
    Logger,
    PluginCommonModule,
    Product,
    ProductVariant,
    RequestContext,
    RequestContextCacheService,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';

import { ProductChannelAvailabilityEvent } from '../events/product-channel-availability.event';
import { resolveEffectiveEnabled } from '../services/availability-rules';
import { ChannelProductAvailabilityService } from '../services/channel-product-availability.service';

const loggerCtx = 'ChannelAvailabilityElasticsearchPlugin';

/** The key under `customProductVariantMappings`. */
export const CHANNEL_ENABLED_MAPPING_KEY = 'channelEnabled';

/** Name of the per-channel availability flag in the variant index. */
export const CHANNEL_ENABLED_FIELD = 'variant-channelEnabled';

/**
 * The variant's own `enabled` value. For a globally disabled product, the Elasticsearch indexer
 * sets `enabled = false` on all of its variants in memory before calling custom mappings, so for
 * those the stored values are read (once per product and request).
 */
async function storedVariantEnabled(injector: Injector, ctx: RequestContext, variant: ProductVariant): Promise<boolean> {
    if (variant.product.enabled) {
        return variant.enabled;
    }
    const productId = variant.product.id;
    const enabledById = await injector
        .get(RequestContextCacheService)
        .get(ctx, `ChannelProductAvailability.es.variants.${String(productId)}`, async () => {
            const rows = await injector
                .get(TransactionalConnection)
                .getRepository(ctx, ProductVariant)
                .find({ where: { productId }, select: ['id', 'enabled'], loadEagerRelations: false });
            return new Map(rows.map(row => [String(row.id), row.enabled]));
        });
    return enabledById.get(String(variant.id)) ?? false;
}

/**
 * For `ElasticsearchOptions.customProductVariantMappings`, under the key `channelEnabled`.
 *
 * The indexer builds each channel's documents with `ctx` set to that channel, so the value is
 * the variant's availability in the channel of the document: the variant is enabled and the
 * product is available there (override ?? Product.enabled). Not exposed in the GraphQL API.
 */
export const channelEnabledVariantMapping = {
    graphQlType: 'Boolean' as const,
    public: false,
    valueFn: async (
        variant: ProductVariant,
        _languageCode: LanguageCode,
        injector: Injector,
        ctx: RequestContext,
    ): Promise<boolean> => {
        const product = variant.product;
        const overrides = await injector
            .get(ChannelProductAvailabilityService)
            .getOverrides(ctx, [product.id], ctx.channelId);
        if (!resolveEffectiveEnabled(product.enabled, overrides.get(String(product.id)))) {
            return false;
        }
        return storedVariantEnabled(injector, ctx, variant);
    },
};

/** For `ElasticsearchOptions.indexMappingProperties`. */
export const channelEnabledIndexMapping = {
    [CHANNEL_ENABLED_FIELD]: { type: 'boolean' as const },
};

/**
 * Replaces the indexer's `{ term: { enabled: true } }` filter (added for Shop API searches) with
 * the channel-aware field. Call it first thing in `searchConfig.mapQuery`, before any early
 * return, or use {@link withChannelAvailability}.
 *
 * Documents indexed before the field existed don't have it: those keep matching on `enabled`
 * until they are reindexed, so search never empties out during a rollout.
 *
 * The swap stays inside `bool.filter`, so relevance scores are unaffected. Leaves the query
 * untouched when `enabledOnly` is false (Admin API), when there is no `bool.filter`, or when it
 * has no `enabled` term. Safe to call more than once.
 */
export function applyChannelAvailabilityFilter(query: any, enabledOnly: boolean): any {
    const filters: any[] | undefined = query?.bool?.filter;
    if (!enabledOnly || !Array.isArray(filters)) {
        return query;
    }
    const index = filters.findIndex(f => f?.term?.enabled === true);
    if (index === -1) {
        return query;
    }
    filters[index] = {
        bool: {
            should: [
                { term: { [CHANNEL_ENABLED_FIELD]: true } },
                {
                    bool: {
                        must: [{ term: { enabled: true } }],
                        must_not: [{ exists: { field: CHANNEL_ENABLED_FIELD } }],
                    },
                },
            ],
            minimum_should_match: 1,
        },
    };
    return query;
}

/**
 * Adds everything the index and the search need to Elasticsearch plugin options: the variant
 * mapping, the index mapping, and the filter, wrapped around any existing `mapQuery` (the
 * filter is applied first, so the existing function still sees `bool.filter` intact).
 */
export function withChannelAvailability<T extends ElasticsearchOptions>(options: T): T {
    const existingMapQuery = options.searchConfig?.mapQuery;
    return {
        ...options,
        customProductVariantMappings: {
            ...(options.customProductVariantMappings ?? {}),
            [CHANNEL_ENABLED_MAPPING_KEY]: channelEnabledVariantMapping,
        },
        indexMappingProperties: {
            ...(options.indexMappingProperties ?? {}),
            ...channelEnabledIndexMapping,
        },
        searchConfig: {
            ...(options.searchConfig ?? {}),
            mapQuery: (query: any, input: any, searchConfig: any, channelId: ID, enabledOnly: boolean, ctx: RequestContext) => {
                const filtered = applyChannelAvailabilityFilter(query, enabledOnly);
                return existingMapQuery
                    ? existingMapQuery(filtered, input, searchConfig, channelId, enabledOnly, ctx)
                    : filtered;
            },
        },
    } as T;
}

/** Changes of one product within this window are reindexed once. */
const REINDEX_DEBOUNCE_MS = 50;

/**
 * Reindexes a product in Elasticsearch when an override is set or cleared. The Elasticsearch
 * plugin already reindexes on the other causes (Product.enabled changes, channel assignment,
 * product deletion).
 *
 * `updateProduct` rebuilds the product's documents in every channel it belongs to, through the
 * job queue: search reflects the change once the worker has run the job. Several overrides of
 * the same product in a short time (e.g. a bulk change across channels) cause one reindex.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    compatibility: '^3.6.0',
})
export class ChannelAvailabilityElasticsearchPlugin implements OnApplicationBootstrap {
    private pending = new Map<string, RequestContext>();
    private timer: NodeJS.Timeout | undefined;
    private elasticsearchIndexService: ElasticsearchIndexService;

    constructor(
        private eventBus: EventBus,
        private moduleRef: ModuleRef,
    ) {}

    onApplicationBootstrap() {
        // The Elasticsearch plugin doesn't export its providers, so look it up across modules.
        try {
            this.elasticsearchIndexService = this.moduleRef.get(ElasticsearchIndexService, { strict: false });
        } catch {
            Logger.error(
                'ElasticsearchPlugin is not installed: overrides will not be reflected in search. ' +
                    'Add ElasticsearchPlugin.init(...) to the plugins, or remove ChannelAvailabilityElasticsearchPlugin.',
                loggerCtx,
            );
            return;
        }
        this.eventBus.ofType(ProductChannelAvailabilityEvent).subscribe(event => {
            if (event.type !== 'set' && event.type !== 'cleared') {
                return;
            }
            this.pending.set(String(event.productId), event.ctx);
            if (!this.timer) {
                this.timer = setTimeout(() => this.flush(), REINDEX_DEBOUNCE_MS);
            }
        });
    }

    private flush() {
        const batch = [...this.pending];
        this.pending.clear();
        this.timer = undefined;
        for (const [productId, ctx] of batch) {
            this.elasticsearchIndexService
                .updateProduct(ctx, { id: productId } as Product)
                .catch((err: any) =>
                    Logger.error(`Could not reindex product ${productId}: ${err?.message ?? String(err)}`, loggerCtx),
                );
        }
    }
}
