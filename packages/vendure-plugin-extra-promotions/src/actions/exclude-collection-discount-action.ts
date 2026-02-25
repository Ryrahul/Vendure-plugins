import { CollectionService, LanguageCode, PromotionItemAction } from '@vendure/core';

import { getVariantIdsForCollections } from '../utils/collection-utils';

let collectionService: CollectionService;

/**
 * @description
 * Applies a percentage discount to each OrderLine item whose product variant
 * does NOT belong to any of the specified collections.
 *
 * Useful for "discount everything except Sale items" promotions.
 */
export const excludeCollectionDiscountAction = new PromotionItemAction({
    code: 'exclude_collection_percentage_discount',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Discount all products EXCEPT those in specified collections by { discount }%',
        },
    ],
    args: {
        discount: {
            type: 'float',
            ui: {
                component: 'number-form-input',
                suffix: '%',
            },
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
    async execute(ctx, orderLine, args) {
        const excludedVariantIds = await getVariantIdsForCollections(
            collectionService,
            args.collectionIds,
            ctx,
        );
        if (!excludedVariantIds.has(String(orderLine.productVariant.id))) {
            const unitPrice = ctx.channel.pricesIncludeTax
                ? orderLine.unitPriceWithTax
                : orderLine.unitPrice;
            return -unitPrice * (args.discount / 100);
        }
        return 0;
    },
});
