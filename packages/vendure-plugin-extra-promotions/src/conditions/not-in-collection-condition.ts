import { CollectionService, LanguageCode, PromotionCondition } from '@vendure/core';

import { getVariantIdsForCollections } from '../utils/collection-utils';

let collectionService: CollectionService;

/**
 * @description
 * Checks if the order contains at least `minimum` items that do NOT belong
 * to any of the specified collections. Useful for "discount everything except
 * items in Sale collection" style promotions.
 */
export const notInCollectionCondition = new PromotionCondition({
    code: 'order_contains_products_not_in_collections',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Order contains at least { minimum } items NOT in the specified collections',
        },
    ],
    args: {
        minimum: {
            type: 'int',
            defaultValue: 1,
            ui: { component: 'number-form-input', min: 1 },
        },
        collectionIds: {
            type: 'ID',
            list: true,
            label: [{ languageCode: LanguageCode.en, value: 'Excluded Collection IDs' }],
            ui: { component: 'extra-promotions-collection-picker' },
        },
    },
    init(injector) {
        collectionService = injector.get(CollectionService);
    },
    async check(ctx, order, args) {
        const excludedVariantIds = await getVariantIdsForCollections(
            collectionService,
            args.collectionIds,
            ctx,
        );
        let matchingQty = 0;
        for (const line of order.lines) {
            if (!excludedVariantIds.has(String(line.productVariant.id))) {
                matchingQty += line.quantity;
            }
        }
        return matchingQty >= args.minimum;
    },
});
