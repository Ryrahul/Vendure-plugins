import { LanguageCode, PromotionItemAction } from '@vendure/core';

import { minStockLevelCondition } from '../conditions/min-stock-level-condition';

/**
 * @description
 * Applies a percentage discount only to order lines whose product variant
 * has stock on hand at or above the threshold defined in the
 * `minStockLevelCondition`.
 *
 * **Must be used together with `minStockLevelCondition`** -- the condition
 * is declared as a dependency and provides the qualifying line IDs.
 */
export const stockClearanceDiscountAction = new PromotionItemAction({
    code: 'stock_clearance_discount',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Discount overstocked items by { discount }%',
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
    conditions: [minStockLevelCondition],
    execute(ctx, orderLine, args, state) {
        const { qualifyingLineIds } = state.min_stock_level;
        if (qualifyingLineIds[String(orderLine.id)]) {
            const unitPrice = ctx.channel.pricesIncludeTax
                ? orderLine.unitPriceWithTax
                : orderLine.unitPrice;
            return -unitPrice * (args.discount / 100);
        }
        return 0;
    },
});
