import { LanguageCode, PromotionItemAction } from '@vendure/core';

import { crossSellCondition } from '../conditions/cross-sell-condition';

/**
 * @description
 * Cross-sell incentive action: if the order contains any of the "trigger"
 * product variants (as determined by the `crossSellCondition`), then the
 * "target" product variants receive a percentage discount.
 *
 * **Must be used together with the `crossSellCondition`** -- the condition
 * is declared as a dependency and provides the state needed by this action.
 *
 * Example: If buying Product A (trigger), get 30% off Product B (target).
 */
export const crossSellDiscountAction = new PromotionItemAction({
    code: 'cross_sell_discount',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Discount target products by { discount }% when trigger products are in the order',
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
    conditions: [crossSellCondition],
    execute(ctx, orderLine, args, state) {
        const { targetLineIds } = state.cross_sell;
        if (targetLineIds[String(orderLine.id)]) {
            const unitPrice = ctx.channel.pricesIncludeTax
                ? orderLine.unitPriceWithTax
                : orderLine.unitPrice;
            return -unitPrice * (args.discount / 100);
        }
        return 0;
    },
});
