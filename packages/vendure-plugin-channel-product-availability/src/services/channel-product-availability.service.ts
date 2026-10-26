import { Injectable } from '@nestjs/common';
import {
    Channel,
    EntityNotFoundError,
    EventBus,
    ID,
    Product,
    ProductVariant,
    RequestContext,
    RequestContextCacheService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, IsNull, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

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

/** Ids per query in the id-list helpers, well below every database's parameter limit. */
const ID_CHUNK_SIZE = 5000;

/**
 * SQL for "available in the channel" given a product alias and a LEFT JOINed override
 * alias: no override and globally enabled, or an enabling override.
 */
const AVAILABLE_CONDITION = (product: string, override: string, param = 'enabled') =>
    `((${override}.id IS NULL AND ${product}.enabled = :${param}) OR ${override}.enabled = :${param})`;

/** Makes aliases and parameter names unique across helper calls on one query. */
let helperCallCounter = 0;

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
    /** Products whose name (in the request language) contains this text, case-insensitive. */
    productName?: string;
    skip?: number;
    take?: number;
}

/** An override row as listed, with the product's name and global `enabled` value. */
export type ListedOverride = ProductChannelAvailability & { productName: string | null; productEnabled: boolean | null };

/** Maximum (product, channel) pairs per bulk call. */
export const BULK_MAX_PAIRS = 1000;

export interface BulkAvailabilitySkip {
    productId: ID;
    channelId: ID;
    reason: string;
}

export interface BulkAvailabilityResult {
    /** Overrides created, changed or removed. */
    updated: number;
    /** Pairs that already had the requested state. */
    unchanged: number;
    /** Pairs that could not be applied; the others still were. */
    skipped: BulkAvailabilitySkip[];
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

    /*
     * ── Helpers for custom queries ──────────────────────────────────────────────
     *
     * One rule everywhere: available(product, channel) = override ?? product.enabled.
     * The helpers also drop deleted products and (for variants) disabled or deleted
     * variants, so one call replaces the usual `enabled` / `deletedAt` checks. Channel
     * membership stays the caller's job: no channel joins are added.
     */

    /**
     * The given variant ids that are available in the channel (default: the active
     * channel), **in the input order**. Drops variants that are disabled or deleted,
     * whose product is deleted, or whose product is effectively disabled in the channel.
     *
     * One query (per 5,000 ids). Empty input returns `[]` without a query.
     *
     * @example
     * ```ts
     * // an id list cached in Redis, filtered on every request, then paged
     * const ids = await availability.filterAvailableVariantIds(ctx, cachedIds);
     * const page = ids.slice(skip, skip + take);
     * ```
     */
    async filterAvailableVariantIds(ctx: RequestContext, variantIds: ID[], channelId: ID = ctx.channelId): Promise<ID[]> {
        if (!variantIds.length) {
            return [];
        }
        const available = new Set<string>();
        for (const chunk of this.chunks(this.uniqueIds(variantIds))) {
            const rows = await this.connection
                .getRepository(ctx, ProductVariant)
                .createQueryBuilder('variant')
                .select('variant.id', 'id')
                .innerJoin('variant.product', 'product')
                .leftJoin(
                    ProductChannelAvailability,
                    'override',
                    'override.productId = product.id AND override.channelId = :channelId',
                    { channelId },
                )
                .where('variant.id IN (:...ids)', { ids: chunk })
                .andWhere('variant.deletedAt IS NULL')
                .andWhere('variant.enabled = :enabled')
                .andWhere('product.deletedAt IS NULL')
                .andWhere(AVAILABLE_CONDITION('product', 'override'), { enabled: true })
                .getRawMany<{ id: ID }>();
            rows.forEach(row => available.add(String(row.id)));
        }
        return variantIds.filter(id => available.has(String(id)));
    }

    /**
     * The given product ids that are available in the channel (default: the active
     * channel), **in the input order**. Drops deleted products and products effectively
     * disabled in the channel. Empty input returns `[]` without a query.
     */
    async filterAvailableProductIds(ctx: RequestContext, productIds: ID[], channelId: ID = ctx.channelId): Promise<ID[]> {
        if (!productIds.length) {
            return [];
        }
        const available = new Set<string>();
        for (const chunk of this.chunks(this.uniqueIds(productIds))) {
            const rows = await this.connection
                .getRepository(ctx, Product)
                .createQueryBuilder('product')
                .select('product.id', 'id')
                .leftJoin(
                    ProductChannelAvailability,
                    'override',
                    'override.productId = product.id AND override.channelId = :channelId',
                    { channelId },
                )
                .where('product.id IN (:...ids)', { ids: chunk })
                .andWhere('product.deletedAt IS NULL')
                .andWhere(AVAILABLE_CONDITION('product', 'override'), { enabled: true })
                .getRawMany<{ id: ID }>();
            rows.forEach(row => available.add(String(row.id)));
        }
        return productIds.filter(id => available.has(String(id)));
    }

    /**
     * Restricts a QueryBuilder that has **already joined the product** under
     * `productAlias` to products available in the channel (and not deleted).
     *
     * Adds `productAlias.id IN (<available products>)` as an `andWhere`, using a subquery
     * on the override table, so no id lists are inlined and empty sets can't produce
     * `IN ()`. Aliases and parameter names are unique per call, so it can be applied
     * twice to one builder (e.g. two product joins).
     *
     * @example
     * ```ts
     * const qb = connection.getRepository(ctx, ProductVariant).createQueryBuilder('variant')
     *     .innerJoin('variant.product', 'product')
     *     .where('variant.enabled = :enabled AND variant.deletedAt IS NULL', { enabled: true });
     * await availability.applyToQueryBuilder(ctx, qb, 'product');
     * ```
     */
    async applyToQueryBuilder<T extends ObjectLiteral>(
        ctx: RequestContext,
        qb: SelectQueryBuilder<T>,
        productAlias: string,
        channelId: ID = ctx.channelId,
    ): Promise<SelectQueryBuilder<T>> {
        const { sql, params } = await this.getAvailableProductIdsSubQuery(ctx, channelId);
        return qb.andWhere(`${productAlias}.id IN (${sql})`, params);
    }

    /**
     * Like {@link applyToQueryBuilder}, for a QueryBuilder on **ProductVariant** under
     * `variantAlias` (no product join needed). Also requires the variant to be enabled
     * and not deleted. Suitable for the builder returned by `ListQueryBuilder.build()`.
     *
     * @example
     * ```ts
     * const qb = listQueryBuilder.build(ProductVariant, options, { ctx, channelId: ctx.channelId });
     * await availability.applyToVariantQueryBuilder(ctx, qb, qb.alias);
     * const [items, totalItems] = await qb.getManyAndCount();
     * ```
     */
    async applyToVariantQueryBuilder<T extends ObjectLiteral>(
        ctx: RequestContext,
        qb: SelectQueryBuilder<T>,
        variantAlias: string,
        channelId: ID = ctx.channelId,
    ): Promise<SelectQueryBuilder<T>> {
        const { sql, params } = await this.getAvailableProductIdsSubQuery(ctx, channelId);
        const suffix = this.nextSuffix();
        return qb
            .andWhere(`${variantAlias}.enabled = :${suffix}_variantEnabled`, { [`${suffix}_variantEnabled`]: true })
            .andWhere(`${variantAlias}.deletedAt IS NULL`)
            .andWhere(`${variantAlias}.productId IN (${sql})`, params);
    }

    /**
     * SQL selecting the ids of products that are available in the channel and not
     * deleted, with named parameters (`:name`, unique per call). Use it in a
     * QueryBuilder (`.andWhere(\`variant.productId IN (${sql})\`, params)`), or in raw
     * SQL via `connection.rawConnection.driver.escapeQueryWithParameters(...)`.
     *
     * Table and column names come from the entity metadata, so `entityPrefix` and naming
     * strategies are respected.
     */
    async getAvailableProductIdsSubQuery(
        ctx: RequestContext,
        channelId: ID = ctx.channelId,
    ): Promise<{ sql: string; params: Record<string, any> }> {
        const suffix = this.nextSuffix();
        const product = `${suffix}_product`;
        const override = `${suffix}_override`;
        const qb = this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder(product)
            .select(`${product}.id`)
            .leftJoin(
                ProductChannelAvailability,
                override,
                `${override}.productId = ${product}.id AND ${override}.channelId = :${suffix}_channelId`,
                { [`${suffix}_channelId`]: channelId },
            )
            .where(`${product}.deletedAt IS NULL`)
            .andWhere(AVAILABLE_CONDITION(product, override, `${suffix}_enabled`), { [`${suffix}_enabled`]: true });
        return { sql: qb.getQuery(), params: qb.getParameters() };
    }

    /**
     * A ListQueryBuilder filter for **ProductVariant** lists (Shop API style): enabled,
     * non-deleted variants of products available in the channel. Combine it with the caller's filter
     * using `enforceGuardFilter`, which also keeps it nested (a top-level
     * `filter.enabled` would trigger core's `product.enabled = true` shortcut and hide
     * products enabled in this channel by an override).
     *
     * It lists the products that are effectively **disabled** in the channel
     * (`productId notIn [...]`), which is normally a short list. If many products are
     * disabled, prefer {@link applyToVariantQueryBuilder} on the built query.
     */
    async getEffectiveEnabledVariantFilter(ctx: RequestContext, channelId: ID = ctx.channelId): Promise<Record<string, any>> {
        const disabledIds = await this.getEffectivelyDisabledProductIds(ctx, channelId);
        return {
            _and: [
                { enabled: { eq: true } },
                // deleting a product soft-deletes its variants too
                { deletedAt: { isNull: true } },
                ...(disabledIds.length ? [{ productId: { notIn: disabledIds } }] : []),
            ],
        };
    }

    /**
     * Ids of products (not deleted) that are effectively disabled in the channel:
     * globally disabled without an enabling override, or disabled by an override.
     * Memoised for the rest of the request.
     */
    async getEffectivelyDisabledProductIds(ctx: RequestContext, channelId: ID = ctx.channelId): Promise<string[]> {
        return this.requestCache.get(ctx, `${OVERRIDES_CACHE_KEY}.disabled.${String(channelId)}`, async () => {
            const rows = await this.connection
                .getRepository(ctx, Product)
                .createQueryBuilder('product')
                .select('product.id', 'id')
                .leftJoin(
                    ProductChannelAvailability,
                    'override',
                    'override.productId = product.id AND override.channelId = :channelId',
                    { channelId },
                )
                .where('product.deletedAt IS NULL')
                .andWhere(
                    '((override.id IS NULL AND product.enabled = :disabled) OR override.enabled = :disabled)',
                    { disabled: false },
                )
                .getRawMany<{ id: ID }>();
            return rows.map(row => String(row.id));
        });
    }

    /**
     * Lists explicit overrides in a channel, with the product's name (in the request
     * language) and global `enabled` value.
     */
    async listOverrides(
        ctx: RequestContext,
        channelId: ID,
        options: ListOverridesOptions = {},
    ): Promise<{ items: ListedOverride[]; totalItems: number }> {
        const qb = this.connection
            .getRepository(ctx, ProductChannelAvailability)
            .createQueryBuilder('override')
            .where('override.channelId = :channelId', { channelId });
        if (options.productId != null) {
            qb.andWhere('override.productId = :productId', { productId: options.productId });
        }
        if (options.enabled != null) {
            qb.andWhere('override.enabled = :enabled', { enabled: options.enabled });
        }
        if (options.productName?.trim()) {
            qb.andWhere(
                qb =>
                    'override.productId IN ' +
                    qb
                        .subQuery()
                        .select('namedProduct.id')
                        .from(Product, 'namedProduct')
                        .innerJoin('namedProduct.translations', 'translation')
                        .where('LOWER(translation.name) LIKE :productName')
                        .getQuery(),
                { productName: `%${options.productName!.trim().toLowerCase()}%` },
            );
        }
        const [rows, totalItems] = await qb
            .orderBy('override.id', 'ASC')
            .skip(options.skip ?? 0)
            .take(Math.min(options.take ?? 50, 1000))
            .getManyAndCount();
        const products = rows.length
            ? await this.connection.getRepository(ctx, Product).find({
                  where: { id: In(rows.map(r => r.productId)) },
                  relations: ['translations'],
                  select: { id: true, enabled: true, translations: { id: true, languageCode: true, name: true } },
                  loadEagerRelations: false,
              })
            : [];
        const items = rows.map(row => {
            const product = products.find(p => String(p.id) === String(row.productId));
            const translation =
                product?.translations.find(t => t.languageCode === ctx.languageCode) ?? product?.translations[0];
            return Object.assign(row, { productName: translation?.name ?? null, productEnabled: product?.enabled ?? null });
        });
        return { items, totalItems };
    }

    /**
     * Sets the override for every (product, channel) pair, in one batched write. Products
     * that don't exist or aren't assigned to a channel, and channels that don't exist, are
     * reported in `skipped`; the other pairs still apply. Publishes one event per changed
     * pair. Run it in a transaction (the Admin API mutation does).
     *
     * Does not check permissions: callers exposing it must (see `ChannelAccessService`).
     *
     * @throws UserInputError for more than {@link BULK_MAX_PAIRS} pairs
     */
    async setOverrides(ctx: RequestContext, productIds: ID[], channelIds: ID[], enabled: boolean): Promise<BulkAvailabilityResult> {
        const { valid, skipped } = await this.resolveBulkPairs(ctx, productIds, channelIds, true);
        const existing = await this.findOverrides(ctx, valid);
        const changed = valid.filter(pair => existing.get(this.cacheKey(pair.channelId, pair.productId))?.enabled !== enabled);
        const repo = this.connection.getRepository(ctx, ProductChannelAvailability);
        const now = new Date();
        for (let i = 0; i < changed.length; i += 500) {
            await repo.upsert(
                changed.slice(i, i + 500).map(pair => ({ ...pair, enabled, updatedAt: now })) as any[],
                { conflictPaths: ['productId', 'channelId'], skipUpdateIfNoValuesChanged: true },
            );
        }
        for (const pair of changed) {
            const previous = existing.get(this.cacheKey(pair.channelId, pair.productId));
            this.invalidate(ctx, pair.channelId, pair.productId);
            await this.searchIndexSync.syncProductInChannel(ctx, pair.productId, pair.channelId);
            await this.eventBus.publish(
                new ProductChannelAvailabilityEvent(
                    ctx,
                    'set',
                    pair.productId,
                    pair.channelId,
                    toOverrideState(previous?.enabled),
                    toOverrideState(enabled),
                ),
            );
        }
        return { updated: changed.length, unchanged: valid.length - changed.length, skipped };
    }

    /**
     * Clears the override for every (product, channel) pair, in one batched delete. Unknown
     * products or channels are reported in `skipped`. Publishes one event per removed override.
     *
     * Does not check permissions: callers exposing it must (see `ChannelAccessService`).
     *
     * @throws UserInputError for more than {@link BULK_MAX_PAIRS} pairs
     */
    async clearOverrides(ctx: RequestContext, productIds: ID[], channelIds: ID[]): Promise<BulkAvailabilityResult> {
        const { valid, skipped } = await this.resolveBulkPairs(ctx, productIds, channelIds, false);
        const existing = await this.findOverrides(ctx, valid);
        const rows = [...existing.values()];
        const repo = this.connection.getRepository(ctx, ProductChannelAvailability);
        for (let i = 0; i < rows.length; i += 500) {
            await repo.delete({ id: In(rows.slice(i, i + 500).map(r => r.id)) });
        }
        for (const row of rows) {
            this.invalidate(ctx, row.channelId, row.productId);
            await this.searchIndexSync.syncProductInChannel(ctx, row.productId, row.channelId);
            await this.eventBus.publish(
                new ProductChannelAvailabilityEvent(
                    ctx,
                    'cleared',
                    row.productId,
                    row.channelId,
                    toOverrideState(row.enabled),
                    'INHERITED',
                ),
            );
        }
        return { updated: rows.length, unchanged: valid.length - rows.length, skipped };
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

    /** Validates bulk input and splits the pairs into applicable ones and skipped ones. */
    private async resolveBulkPairs(
        ctx: RequestContext,
        productIds: ID[],
        channelIds: ID[],
        requireAssignment: boolean,
    ): Promise<{ valid: Array<{ productId: ID; channelId: ID }>; skipped: BulkAvailabilitySkip[] }> {
        const products = this.uniqueIds(productIds);
        const channelList = this.uniqueIds(channelIds);
        if (products.length * channelList.length > BULK_MAX_PAIRS) {
            throw new UserInputError(
                `Too many changes in one call: ${products.length} products × ${channelList.length} channels = ` +
                    `${products.length * channelList.length} pairs (at most ${BULK_MAX_PAIRS}). Split it into smaller batches.`,
            );
        }
        const [productRows, channelRows] = await Promise.all([
            products.length
                ? this.connection.getRepository(ctx, Product).find({
                      where: { id: In(products), deletedAt: IsNull() },
                      relations: requireAssignment ? ['channels'] : [],
                      loadEagerRelations: false,
                  })
                : [],
            channelList.length
                ? this.connection.getRepository(ctx, Channel).find({ where: { id: In(channelList) }, select: ['id', 'code'] })
                : [],
        ]);
        const valid: Array<{ productId: ID; channelId: ID }> = [];
        const skipped: BulkAvailabilitySkip[] = [];
        for (const productId of products) {
            const product = productRows.find(p => String(p.id) === String(productId));
            for (const channelId of channelList) {
                const channel = channelRows.find(c => String(c.id) === String(channelId));
                if (!channel) {
                    skipped.push({ productId, channelId, reason: 'Channel not found' });
                } else if (!product) {
                    skipped.push({ productId, channelId, reason: 'Product not found' });
                } else if (requireAssignment && !product.channels.some(c => String(c.id) === String(channelId))) {
                    skipped.push({ productId, channelId, reason: `Product is not assigned to channel "${channel.code}"` });
                } else {
                    valid.push({ productId: product.id, channelId: channel.id });
                }
            }
        }
        return { valid, skipped };
    }

    /** Existing overrides of the given pairs, keyed by `cacheKey(channelId, productId)`. */
    private async findOverrides(
        ctx: RequestContext,
        pairs: Array<{ productId: ID; channelId: ID }>,
    ): Promise<Map<string, ProductChannelAvailability>> {
        const result = new Map<string, ProductChannelAvailability>();
        if (!pairs.length) {
            return result;
        }
        const rows = await this.connection.getRepository(ctx, ProductChannelAvailability).find({
            where: {
                productId: In(this.uniqueIds(pairs.map(p => p.productId))),
                channelId: In(this.uniqueIds(pairs.map(p => p.channelId))),
            },
        });
        for (const row of rows) {
            result.set(this.cacheKey(row.channelId, row.productId), row);
        }
        return result;
    }

    private getRequestCache(ctx: RequestContext): Map<string, boolean | null> {
        return this.requestCache.get(ctx, OVERRIDES_CACHE_KEY, () => new Map<string, boolean | null>());
    }

    private invalidate(ctx: RequestContext, channelId: ID, productId: ID) {
        this.getRequestCache(ctx).delete(this.cacheKey(channelId, productId));
        this.requestCache.set(ctx, `${OVERRIDES_CACHE_KEY}.sets.${String(channelId)}`, undefined);
        this.requestCache.set(ctx, `${OVERRIDES_CACHE_KEY}.disabled.${String(channelId)}`, undefined);
    }

    private nextSuffix(): string {
        helperCallCounter = (helperCallCounter + 1) % Number.MAX_SAFE_INTEGER;
        return `plca${helperCallCounter}`;
    }

    private uniqueIds(ids: ID[]): ID[] {
        const seen = new Set<string>();
        return ids.filter(id => (seen.has(String(id)) ? false : (seen.add(String(id)), true)));
    }

    private chunks<T>(items: T[]): T[][] {
        const result: T[][] = [];
        for (let i = 0; i < items.length; i += ID_CHUNK_SIZE) {
            result.push(items.slice(i, i + ID_CHUNK_SIZE));
        }
        return result;
    }

    private cacheKey(channelId: ID, productId: ID) {
        return `${String(channelId)}:${String(productId)}`;
    }
}
