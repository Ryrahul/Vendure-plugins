import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ID, Product, ProductVariant, RequestContext, TransactionalConnection } from '@vendure/core';
import { In, IsNull } from 'typeorm';

import { CHANNEL_PRODUCT_AVAILABILITY_OPTIONS } from '../constants';
import { ProductChannelAvailability } from '../entities/product-channel-availability.entity';
import { resolveEffectiveEnabled } from '../services/availability-rules';
import { ResolvedChannelProductAvailabilityOptions } from '../types';
import { SearchIndexAvailabilitySubscriber } from './search-index-availability.subscriber';
import { getSearchIndexItemMetadata } from './search-index-item-metadata';

/**
 * Patches existing DefaultSearchPlugin index rows when an override changes, inside
 * the caller's transaction, so `search` reflects the change immediately.
 *
 * Rows written later by the indexer are corrected by
 * `SearchIndexAvailabilitySubscriber`.
 */
@Injectable()
export class SearchIndexSyncService implements OnModuleInit {
    constructor(
        private connection: TransactionalConnection,
        @Inject(CHANNEL_PRODUCT_AVAILABILITY_OPTIONS) private options: ResolvedChannelProductAvailabilityOptions,
    ) {}

    /**
     * Registers the index-write subscriber on the live DataSource, the same way core
     * registers its own runtime subscribers. Runs in both server and worker, so rows
     * written by the indexer in the worker are corrected too.
     */
    onModuleInit() {
        if (!this.isActive()) {
            return;
        }
        const subscribers = this.connection.rawConnection.subscribers;
        if (!subscribers.some(s => s instanceof SearchIndexAvailabilitySubscriber)) {
            subscribers.push(new SearchIndexAvailabilitySubscriber());
        }
    }

    isActive(): boolean {
        return this.options.syncDefaultSearchIndex && !!getSearchIndexItemMetadata(this.connection.rawConnection);
    }

    async syncProductInChannel(ctx: RequestContext, productId: ID, channelId: ID): Promise<void> {
        const metadata = getSearchIndexItemMetadata(this.connection.rawConnection);
        if (!this.options.syncDefaultSearchIndex || !metadata) {
            return;
        }
        const product = await this.connection
            .getRepository(ctx, Product)
            .findOne({ where: { id: productId }, select: ['id', 'enabled'], loadEagerRelations: false });
        if (!product) {
            return;
        }
        const override = await this.connection
            .getRepository(ctx, ProductChannelAvailability)
            .findOne({ where: { productId, channelId } });
        const productEnabled = resolveEffectiveEnabled(product.enabled, override?.enabled);
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { productId, deletedAt: IsNull() },
            select: ['id', 'enabled'],
            loadEagerRelations: false,
        });
        const enabledIds = variants.filter(v => productEnabled && v.enabled).map(v => v.id);
        const disabledIds = variants.filter(v => !(productEnabled && v.enabled)).map(v => v.id);
        const repo = this.connection.getRepository(ctx, metadata.target as any);
        if (enabledIds.length) {
            await repo.update({ productId, channelId, productVariantId: In(enabledIds) }, { enabled: true });
        }
        if (disabledIds.length) {
            await repo.update({ productId, channelId, productVariantId: In(disabledIds) }, { enabled: false });
        }
    }
}
