import { CollectionService, LanguageCode, PromotionItemAction } from '@vendure/core';

import { getVariantIdsForCollections } from '../utils/collection-utils';

let collectionService: CollectionService;

/**
 * @description
 * Applies a percentage discount to each OrderLine item whose product variant
 * belongs to any of the specified collections.
 */
export const collectionDiscountAction = new PromotionItemAction({
    code: 'collection_percentage_discount',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Discount products in specified collections by { discount }%',
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
            label: [{ languageCode: LanguageCode.en, value: 'Collection IDs' }],
            ui: { component: 'extra-promotions-collection-picker' },
        },
    },
    init(injector) {
        collectionService = injector.get(CollectionService);
    },
    async execute(ctx, orderLine, args) {
        const allVariantIds = await getVariantIdsForCollections(
            collectionService,
            args.collectionIds,
            ctx,
        );
        if (allVariantIds.has(String(orderLine.productVariant.id))) {
            const unitPrice = ctx.channel.pricesIncludeTax
                ? orderLine.unitPriceWithTax
                : orderLine.unitPrice;
            return -unitPrice * (args.discount / 100);
        }
        return 0;
    },
});
