import { Collection, CollectionService, ID, RequestContext } from '@vendure/core';

/**
 * In-memory cache for collection variant IDs to avoid repeated DB queries
 * during a single promotion evaluation cycle. Keyed by collection ID.
 */
const collectionVariantCache = new Map<string, { ids: Set<string>; timestamp: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Returns the set of ProductVariant IDs belonging to the given collection.
 * Results are cached for 30 seconds.
 */
export async function getCollectionVariantIds(
    collectionService: CollectionService,
    collectionId: ID,
    ctx?: RequestContext,
): Promise<Set<string>> {
    const key = String(collectionId);
    const cached = collectionVariantCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.ids;
    }
    const variantIds = await collectionService.getCollectionProductVariantIds(
        { id: collectionId } as Collection,
        ctx,
    );
    const idSet = new Set(variantIds.map(String));
    collectionVariantCache.set(key, { ids: idSet, timestamp: Date.now() });
    return idSet;
}

/**
 * Builds a combined set of all variant IDs across multiple collections.
 */
export async function getVariantIdsForCollections(
    collectionService: CollectionService,
    collectionIds: ID[],
    ctx?: RequestContext,
): Promise<Set<string>> {
    const allVariantIds = new Set<string>();
    for (const collectionId of collectionIds) {
        const variantIds = await getCollectionVariantIds(collectionService, collectionId, ctx);
        for (const id of variantIds) {
            allVariantIds.add(id);
        }
    }
    return allVariantIds;
}
