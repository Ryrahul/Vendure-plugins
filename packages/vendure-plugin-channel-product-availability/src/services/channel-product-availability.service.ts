import { Injectable } from '@nestjs/common';
import {
    Channel,
    EntityNotFoundError,
    EventBus,
    ID,
    Product,
    RequestContext,
    RequestContextCacheService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, IsNull } from 'typeorm';

import { OVERRIDES_CACHE_KEY } from '../constants';
import { ProductChannelAvailability } from '../entities/product-channel-availability.entity';
import { ProductChannelAvailabilityEvent } from '../events/product-channel-availability.event';
import { SearchIndexSyncService } from '../search/search-index-sync.service';
import {
    buildEffectiveEnabledProductFilter,
    OverrideState,
    OverrideValue,
    resolveEffectiveEnabled,
    toOverrideState,
} from './availability-rules';

/**
 * Availability of one product in one channel.
 */
export interface ProductChannelAvailabilityResult {
    productId: ID;
    channelId: ID;
    channelCode: string;
    /** The global `Product.enabled` value. */
    globalEnabled: boolean;
    /** The explicit override, or `null` when the product inherits the global flag. */
    override: boolean | null;
    overrideState: OverrideState;
    /** What the storefront and checkout actually enforce. */
    effectiveEnabled: boolean;
    /** Whether the product is assigned to the channel at all. */
    productInChannel: boolean;
    updatedAt: Date | null;
}

export interface ListOverridesOptions {
    productId?: ID;
    enabled?: boolean;
    skip?: number;
    take?: number;
}

/**
 * The single source of truth for channel-specific product availability.
 *
 * Every enforcement layer (catalog resolvers, search index, order interceptor,
 * order process, admin API) reads availability through this service.
 */
@Injectable()
export class ChannelProductAvailabilityService {
    constructor(
        private connection: TransactionalConnection,
        private eventBus: EventBus,
        private requestCache: RequestContextCacheService,
        private searchIndexSync: SearchIndexSyncService,
    ) {}

    /**
     * Availability of a product in the active channel.
     */
    async getAvailability(ctx: RequestContext, productId: ID): Promise<ProductChannelAvailabilityResult> {
        return this.getAvailabilityForChannel(ctx, productId, ctx.channelId);
    }

    /**
     * Availability of a product in a given channel. Does **not** check that the
     * caller may access that channel — callers exposing this to users must do so
     * (see `ChannelAccessService`).
     */
    async getAvailabilityForChannel(
        ctx: RequestContext,
        productId: ID,
        channelId: ID,
    ): Promise<ProductChannelAvailabilityResult> {
        const [result] = await this.getAvailabilityForChannels(ctx, productId, [channelId]);
        return result;
    }

    /**
     * Availability of a product in each of the given channels, in one round of queries.
     */
    async getAvailabilityForChannels(
        ctx: RequestContext,
        productId: ID,
        channelIds: ID[],
    ): Promise<ProductChannelAvailabilityResult[]> {
        const product = await this.getProductOrThrow(ctx, productId, true);
        const channels = await this.connection
            .getRepository(ctx, Channel)
            .find({ where: { id: In(channelIds) }, select: ['id', 'code'] });
        for (const channelId of channelIds) {
            if (!channels.find(c => String(c.id) === String(channelId))) {
                throw new EntityNotFoundError('Channel', channelId);
            }
        }
        const overrides = channelIds.length
            ? await this.connection.getRepository(ctx, ProductChannelAvailability).find({
                  where: { productId: product.id, channelId: In(channelIds) },
              })
            : [];
        return channelIds.map(channelId => {
            const channel = channels.find(c => String(c.id) === String(channelId)) as Channel;
            const row = overrides.find(o => String(o.channelId) === String(channelId));
            return this.toResult(product, channel, row);
        });
    }

    /**
     * Whether the product is effectively enabled in the active channel.
     *
     * Pass the already-loaded product's `enabled` value as `globalEnabled` to save a
     * query when it is at hand.
     */
    async isEnabled(ctx: RequestContext, productId: ID, globalEnabled?: boolean): Promise<boolean> {
        const overrides = await this.getOverrides(ctx, [productId]);
        const override = overrides.get(String(productId));
        if (override != null) {
            return override;
        }
        if (globalEnabled != null) {
            return globalEnabled;
        }
        const product = await this.connection
            .getRepository(ctx, Product)
            .findOne({ where: { id: productId }, select: ['id', 'enabled'], loadEagerRelations: false });
        return product ? product.enabled : false;
    }

    /**
     * Explicit overrides for the given products in a channel (default: active channel).
     * Products without an override are absent from the map.
     *
     * Batched into one query and memoised for the rest of the request.
     */
    async getOverrides(ctx: RequestContext, productIds: ID[], channelId: ID = ctx.channelId): Promise<Map<string, boolean>> {
        const cache = this.getRequestCache(ctx);
        const missing = productIds.filter(id => !cache.has(this.cacheKey(channelId, id)));
        if (missing.length) {
            const rows = await this.connection.getRepository(ctx, ProductChannelAvailability).find({
                where: { channelId, productId: In(missing) },
                select: ['productId', 'enabled'],
            });
            for (const id of missing) {
                const row = rows.find(r => String(r.productId) === String(id));
                cache.set(this.cacheKey(channelId, id), row ? row.enabled : null);
            }
        }
        const result = new Map<string, boolean>();
        for (const id of productIds) {
            const value = cache.get(this.cacheKey(channelId, id));
            if (value != null) {
                result.set(String(id), value);
            }
        }
        return result;
    }

    /**
     * IDs of every product with an explicit override in a channel, split by value.
     * Used to build SQL-level catalog filters.
     */
    async getOverrideIdSets(
        ctx: RequestContext,
        channelId: ID = ctx.channelId,
    ): Promise<{ enabledIds: string[]; disabledIds: string[] }> {
        return this.requestCache.get(ctx, `${OVERRIDES_CACHE_KEY}.sets.${String(channelId)}`, async () => {
            const rows = await this.connection
                .getRepository(ctx, ProductChannelAvailability)
                .find({ where: { channelId }, select: ['productId', 'enabled'] });
            return {
                enabledIds: rows.filter(r => r.enabled).map(r => String(r.productId)),
                disabledIds: rows.filter(r => !r.enabled).map(r => String(r.productId)),
            };
        });
    }

    /**
     * A ListQueryBuilder filter selecting products that are effectively enabled in
     * the active channel. Use it to make custom product queries channel-aware.
     */
    async getEffectiveEnabledProductFilter(ctx: RequestContext): Promise<Record<string, any>> {
        const { enabledIds, disabledIds } = await this.getOverrideIdSets(ctx);
        return buildEffectiveEnabledProductFilter(enabledIds, disabledIds);
    }

    /**
     * Lists explicit overrides in a channel.
     */
    async listOverrides(
        ctx: RequestContext,
        channelId: ID,
        options: ListOverridesOptions = {},
    ): Promise<{ items: ProductChannelAvailability[]; totalItems: number }> {
        const where: Record<string, any> = { channelId };
        if (options.productId != null) {
            where.productId = options.productId;
        }
        if (options.enabled != null) {
            where.enabled = options.enabled;
        }
        const [items, totalItems] = await this.connection.getRepository(ctx, ProductChannelAvailability).findAndCount({
            where,
            order: { id: 'ASC' },
            skip: options.skip ?? 0,
            take: Math.min(options.take ?? 50, 1000),
        });
        return { items, totalItems };
    }

    /**
     * Sets an explicit override. Idempotent: writing the current value is a no-op and
     * publishes no event. Never changes `Product.enabled` or channel assignment.
     *
     * @throws EntityNotFoundError if the product or channel does not exist
     * @throws UserInputError if the product is not assigned to the channel
     */
    async setOverride(
        ctx: RequestContext,
        productId: ID,
        enabled: boolean,
        channelId: ID = ctx.channelId,
    ): Promise<ProductChannelAvailabilityResult> {
        await this.assertProductInChannel(ctx, productId, channelId);
        const repo = this.connection.getRepository(ctx, ProductChannelAvailability);
        const existing = await repo.findOne({ where: { productId, channelId } });
        if (existing?.enabled !== enabled) {
            // Upsert on the unique (productId, channelId) key: concurrent writers can
            // never produce a duplicate row; the last writer wins.
            await repo.upsert(
                { productId, channelId, enabled, updatedAt: new Date() } as any,
                { conflictPaths: ['productId', 'channelId'], skipUpdateIfNoValuesChanged: true },
            );
            this.invalidate(ctx, channelId, productId);
            await this.searchIndexSync.syncProductInChannel(ctx, productId, channelId);
            await this.eventBus.publish(
                new ProductChannelAvailabilityEvent(
                    ctx,
                    'set',
                    productId,
                    channelId,
                    toOverrideState(existing?.enabled),
                    toOverrideState(enabled),
                ),
            );
        }
        return this.getAvailabilityForChannel(ctx, productId, channelId);
    }

    /**
     * Removes the override so the product inherits `Product.enabled` again.
     * Idempotent: clearing a non-existent override is a no-op.
     *
     * @throws EntityNotFoundError if the product or channel does not exist
     */
    async clearOverride(
        ctx: RequestContext,
        productId: ID,
        channelId: ID = ctx.channelId,
    ): Promise<ProductChannelAvailabilityResult> {
        await this.getProductOrThrow(ctx, productId, false);
        const repo = this.connection.getRepository(ctx, ProductChannelAvailability);
        const existing = await repo.findOne({ where: { productId, channelId } });
        if (existing) {
            await repo.delete({ productId, channelId });
            this.invalidate(ctx, channelId, productId);
            await this.searchIndexSync.syncProductInChannel(ctx, productId, channelId);
            await this.eventBus.publish(
                new ProductChannelAvailabilityEvent(
                    ctx,
                    'cleared',
                    productId,
                    channelId,
                    toOverrideState(existing.enabled),
                    'INHERITED',
                ),
            );
        }
        return this.getAvailabilityForChannel(ctx, productId, channelId);
    }

    /**
     * Removes overrides as a side effect of catalog changes (product deleted, product
     * removed from a channel, channel deleted). Publishes a `removed` event per row.
     */
    async removeOverrides(ctx: RequestContext, criteria: { productId?: ID; channelId?: ID }): Promise<number> {
        if (criteria.productId == null && criteria.channelId == null) {
            throw new UserInputError('removeOverrides requires a productId and/or channelId');
        }
        const repo = this.connection.getRepository(ctx, ProductChannelAvailability);
        const rows = await repo.find({ where: { ...criteria } });
        if (!rows.length) {
            return 0;
        }
        await repo.delete({ id: In(rows.map(r => r.id)) });
        for (const row of rows) {
            this.invalidate(ctx, row.channelId, row.productId);
            await this.eventBus.publish(
                new ProductChannelAvailabilityEvent(
                    ctx,
                    'removed',
                    row.productId,
                    row.channelId,
                    toOverrideState(row.enabled),
                    'INHERITED',
                ),
            );
        }
        return rows.length;
    }

    resolveEffective(globalEnabled: boolean, override: OverrideValue): boolean {
        return resolveEffectiveEnabled(globalEnabled, override);
    }

    private toResult(
        product: Product,
        channel: Channel,
        row: ProductChannelAvailability | undefined,
    ): ProductChannelAvailabilityResult {
        const override = row ? row.enabled : null;
        return {
            productId: product.id,
            channelId: channel.id,
            channelCode: channel.code,
            globalEnabled: product.enabled,
            override,
            overrideState: toOverrideState(override),
            effectiveEnabled: resolveEffectiveEnabled(product.enabled, override),
            productInChannel: product.channels.some(c => String(c.id) === String(channel.id)),
            updatedAt: row ? row.updatedAt : null,
        };
    }

    private async getProductOrThrow(ctx: RequestContext, productId: ID, withChannels: boolean): Promise<Product> {
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: productId, deletedAt: IsNull() },
            relations: withChannels ? ['channels'] : [],
            loadEagerRelations: false,
        });
        if (!product) {
            throw new EntityNotFoundError('Product', productId);
        }
        return product;
    }

    private async assertProductInChannel(ctx: RequestContext, productId: ID, channelId: ID): Promise<void> {
        const product = await this.getProductOrThrow(ctx, productId, true);
        const channel = await this.connection.getRepository(ctx, Channel).findOne({ where: { id: channelId } });
        if (!channel) {
            throw new EntityNotFoundError('Channel', channelId);
        }
        if (!product.channels.some(c => String(c.id) === String(channelId))) {
            throw new UserInputError(
                `Product ${String(productId)} is not assigned to channel "${channel.code}". ` +
                    `Assign it to the channel before setting a channel availability override.`,
            );
        }
    }

    private getRequestCache(ctx: RequestContext): Map<string, boolean | null> {
        return this.requestCache.get(ctx, OVERRIDES_CACHE_KEY, () => new Map<string, boolean | null>());
    }

    private invalidate(ctx: RequestContext, channelId: ID, productId: ID) {
        this.getRequestCache(ctx).delete(this.cacheKey(channelId, productId));
        this.requestCache.set(ctx, `${OVERRIDES_CACHE_KEY}.sets.${String(channelId)}`, undefined);
    }

    private cacheKey(channelId: ID, productId: ID) {
        return `${String(channelId)}:${String(productId)}`;
    }
}
