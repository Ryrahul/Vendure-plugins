import { LanguageCode, PromotionCondition, StockLevelService } from '@vendure/core';

let stockLevelService: StockLevelService;

/**
 * @description
 * Checks if any product variant in the order has stock on hand at or above
 * a specified threshold. Useful for stock clearance campaigns.
 *
 * Returns a state object containing the IDs of qualifying order lines,
 * so that the paired `stockClearanceDiscountAction` can apply the discount
 * only to those specific lines.
 */
export const minStockLevelCondition = new PromotionCondition({
    code: 'min_stock_level',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Order contains items with stock on hand >= { minStockLevel } (stock clearance)',
        },
    ],
    args: {
        minStockLevel: {
            type: 'int',
            defaultValue: 100,
            label: [{ languageCode: LanguageCode.en, value: 'Minimum stock level' }],
            ui: { component: 'number-form-input', min: 0 },
        },
    },
    init(injector) {
        stockLevelService = injector.get(StockLevelService);
    },
    async check(ctx, order, args) {
        const qualifyingLineIds: Record<string, boolean> = {};
        for (const line of order.lines) {
            const availableStock = await stockLevelService.getAvailableStock(
                ctx,
                line.productVariant.id,
            );
            if (availableStock.stockOnHand >= args.minStockLevel) {
                qualifyingLineIds[String(line.id)] = true;
            }
        }
        if (Object.keys(qualifyingLineIds).length === 0) {
            return false;
        }
        return { qualifyingLineIds };
    },
});
