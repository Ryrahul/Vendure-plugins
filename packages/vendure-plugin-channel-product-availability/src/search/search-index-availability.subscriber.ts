import { ProductVariant } from '@vendure/core';
import { EntityManager, EntitySubscriberInterface, In, InsertEvent, UpdateEvent } from 'typeorm';

import { ProductChannelAvailability } from '../entities/product-channel-availability.entity';
import { SEARCH_INDEX_ITEM_ENTITY_NAME } from './search-index-item-metadata';

interface IndexRow {
    productId: string | number;
    productVariantId: string | number;
    channelId: string | number;
    enabled: boolean;
}

interface PendingBatch {
    rows: IndexRow[];
    done: Promise<void>;
}

/**
 * Rewrites `SearchIndexItem.enabled` as DefaultSearchPlugin writes index rows, so
 * the index — and therefore `search` results, counts, pagination and facets —
 * honours channel overrides.
 *
 * DefaultSearchPlugin writes rows with `repository.save()` (<= 3.7) or
 * `repository.upsert()` (3.8+); both fire `beforeInsert`/`beforeUpdate` for every
 * row of a statement synchronously and await the returned promises before building
 * SQL. Rows are therefore collected per EntityManager and resolved with a single
 * query on the next micro-task: one lookup per statement, not per row.
 *
 * Index row rule (matches core, with the override applied):
 *   override = false → enabled = false
 *   override = true  → enabled = variant.enabled
 *   no override      → unchanged (core: product.enabled && variant.enabled)
 */
export class SearchIndexAvailabilitySubscriber implements EntitySubscriberInterface<any> {
    private batches = new WeakMap<EntityManager, PendingBatch>();

    // No `listenTo()`: SearchIndexItem is not exported from @vendure/core, so events
    // are filtered by entity name instead.

    beforeInsert(event: InsertEvent<any>): Promise<void> | void {
        if (event.metadata.name === SEARCH_INDEX_ITEM_ENTITY_NAME && event.entity) {
            return this.enqueue(event.manager, event.entity);
        }
    }

    beforeUpdate(event: UpdateEvent<any>): Promise<void> | void {
        if (event.metadata.name === SEARCH_INDEX_ITEM_ENTITY_NAME && event.entity) {
            return this.enqueue(event.manager, event.entity as IndexRow);
        }
    }

    private enqueue(manager: EntityManager, row: IndexRow): Promise<void> | void {
        // Synthetic rows (products without variants) are always disabled by core.
        if (!row.productVariantId || String(row.productVariantId) === '0' || row.productId == null) {
            return;
        }
        let batch = this.batches.get(manager);
        if (!batch) {
            const rows: IndexRow[] = [];
            const done = Promise.resolve().then(() => {
                this.batches.delete(manager);
                return this.apply(manager, rows);
            });
            batch = { rows, done };
            this.batches.set(manager, batch);
        }
        batch.rows.push(row);
        return batch.done;
    }

    private async apply(manager: EntityManager, rows: IndexRow[]): Promise<void> {
        const productIds = unique(rows.map(r => String(r.productId)));
        const channelIds = unique(rows.map(r => String(r.channelId)));
        const overrides = await manager.getRepository(ProductChannelAvailability).find({
            where: { productId: In(productIds), channelId: In(channelIds) },
            select: ['productId', 'channelId', 'enabled'],
        });
        if (!overrides.length) {
            return;
        }
        const overrideMap = new Map(overrides.map(o => [`${String(o.productId)}:${String(o.channelId)}`, o.enabled]));
        const enabledByOverride = rows.filter(r => overrideMap.get(`${String(r.productId)}:${String(r.channelId)}`) === true);
        const variantEnabled = new Map<string, boolean>();
        if (enabledByOverride.length) {
            const variants = await manager.getRepository(ProductVariant).find({
                where: { id: In(unique(enabledByOverride.map(r => String(r.productVariantId)))) },
                select: ['id', 'enabled'],
                loadEagerRelations: false,
            });
            for (const v of variants) {
                variantEnabled.set(String(v.id), v.enabled);
            }
        }
        for (const row of rows) {
            const override = overrideMap.get(`${String(row.productId)}:${String(row.channelId)}`);
            if (override === false) {
                row.enabled = false;
            } else if (override === true) {
                row.enabled = variantEnabled.get(String(row.productVariantId)) ?? false;
            }
        }
    }
}

function unique<T>(items: T[]): T[] {
    return Array.from(new Set(items));
}
