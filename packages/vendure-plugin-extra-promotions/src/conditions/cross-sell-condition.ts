import { LanguageCode, PromotionCondition } from '@vendure/core';

/**
 * @description
 * Cross-sell condition: checks if the order contains any of the "trigger"
 * product variants. If so, returns a state object containing the set of
 * target line IDs that should receive a discount.
 *
 * This condition is designed to be used together with `crossSellDiscountAction`.
 */
export const crossSellCondition = new PromotionCondition({
    code: 'cross_sell',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Order contains trigger products (for cross-sell discount)',
        },
    ],
    args: {
        triggerProductVariantIds: {
            type: 'ID',
            list: true,
            label: [{ languageCode: LanguageCode.en, value: 'Trigger product variants' }],
            ui: { component: 'product-selector-form-input' },
        },
        targetProductVariantIds: {
            type: 'ID',
            list: true,
            label: [{ languageCode: LanguageCode.en, value: 'Target product variants (to discount)' }],
            ui: { component: 'product-selector-form-input' },
        },
    },
    check(ctx, order, args) {
        const triggerIds = new Set(args.triggerProductVariantIds.map(String));
        const targetIds = new Set(args.targetProductVariantIds.map(String));

        // Check if the order contains any trigger product
        const orderHasTrigger = order.lines.some(line =>
            triggerIds.has(String(line.productVariant.id)),
        );

        if (!orderHasTrigger) {
            return false;
        }

        // Build a map of target line IDs that should receive the discount
        const targetLineIds: Record<string, boolean> = {};
        for (const line of order.lines) {
            if (targetIds.has(String(line.productVariant.id))) {
                targetLineIds[String(line.id)] = true;
            }
        }

        if (Object.keys(targetLineIds).length === 0) {
            return false;
        }

        return { targetLineIds };
    },
});
