import { CollectionService, LanguageCode, PromotionCondition } from '@vendure/core';

import { getVariantIdsForCollections } from '../utils/collection-utils';

let collectionService: CollectionService;

/**
 * @description
 * Checks if the order contains at least `minimum` items that belong to
 * any of the specified collections.
 */
export const collectionContainsCondition = new PromotionCondition({
    code: 'order_contains_products_in_collections',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Order contains at least { minimum } items from the specified collections',
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
            label: [{ languageCode: LanguageCode.en, value: 'Collection IDs' }],
            ui: { component: 'extra-promotions-collection-picker' },
        },
    },
    init(injector) {
        collectionService = injector.get(CollectionService);
    },
    async check(ctx, order, args) {
        const allVariantIds = await getVariantIdsForCollections(
            collectionService,
            args.collectionIds,
            ctx,
        );
        let matchingQty = 0;
        for (const line of order.lines) {
            if (allVariantIds.has(String(line.productVariant.id))) {
                matchingQty += line.quantity;
            }
        }
        return matchingQty >= args.minimum;
    },
});
