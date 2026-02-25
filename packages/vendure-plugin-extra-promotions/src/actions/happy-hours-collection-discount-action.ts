import { LanguageCode, PromotionItemAction } from '@vendure/core';

import { happyHoursCollectionCondition } from '../conditions/happy-hours-collection-condition';

/**
 * @description
 * Applies a percentage discount only to order lines whose product variant
 * belongs to the specified collections **and** only during the happy-hour
 * time window.
 *
 * **Must be used together with `happyHoursCollectionCondition`** -- the
 * condition is declared as a dependency and provides the qualifying line IDs.
 */
export const happyHoursCollectionDiscountAction = new PromotionItemAction({
    code: 'happy_hours_collection_discount',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Happy-hour discount: { discount }% off products in selected collections',
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
    },
    conditions: [happyHoursCollectionCondition],
    execute(ctx, orderLine, args, state) {
        const { qualifyingLineIds } = state.happy_hours_collection;
        if (qualifyingLineIds[String(orderLine.id)]) {
            const unitPrice = ctx.channel.pricesIncludeTax
                ? orderLine.unitPriceWithTax
                : orderLine.unitPrice;
            return -unitPrice * (args.discount / 100);
        }
        return 0;
    },
});
