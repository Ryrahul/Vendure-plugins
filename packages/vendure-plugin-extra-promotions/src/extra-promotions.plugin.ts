import { PluginCommonModule, RuntimeVendureConfig, VendurePlugin } from '@vendure/core';

import { collectionDiscountAction } from './actions/collection-discount-action';
import { crossSellDiscountAction } from './actions/cross-sell-discount-action';
import { excludeCollectionDiscountAction } from './actions/exclude-collection-discount-action';
import { happyHoursCollectionDiscountAction } from './actions/happy-hours-collection-discount-action';
import { stockClearanceDiscountAction } from './actions/stock-clearance-discount-action';
import { collectionContainsCondition } from './conditions/collection-contains-condition';
import { crossSellCondition } from './conditions/cross-sell-condition';
import { firstOrderCondition } from './conditions/first-order-condition';
import { happyHoursCollectionCondition } from './conditions/happy-hours-collection-condition';
import { minOrderCountCondition } from './conditions/min-order-count-condition';
import { minStockLevelCondition } from './conditions/min-stock-level-condition';
import { notInCollectionCondition } from './conditions/not-in-collection-condition';
import { timeRangeCondition } from './conditions/time-range-condition';
import { weekdayCondition } from './conditions/weekday-condition';

/**
 * @description
 * A plugin that provides additional promotion conditions and actions beyond
 * the Vendure defaults.
 *
 * ## Conditions
 * - **First Order** - Customer is placing their first order
 * - **Collection Contains** - Order contains items from specified collections
 * - **Not In Collection** - Order contains items NOT in specified collections
 * - **Min Order Count** - Customer has placed a minimum number of previous orders
 * - **Min Stock Level** - Order contains overstocked items (stock clearance)
 * - **Time Range** - Current time is within a time window (Happy Hour)
 * - **Weekday** - Current day matches specified days of the week
 * - **Cross-Sell** - Order contains trigger products (used with Cross-Sell Discount action)
 * - **Happy Hours Collection** - Current time is within a time window AND order contains items from specified collections
 *
 * ## Actions
 * - **Collection Discount** - Percentage discount on items in specified collections
 * - **Exclude Collection Discount** - Percentage discount on items NOT in specified collections
 * - **Cross-Sell Discount** - If order contains trigger products, discount target products
 * - **Stock Clearance Discount** - Percentage discount on overstocked items only
 * - **Happy Hours Collection Discount** - Percentage discount on items in specified collections during happy hour
 *
 * @example
 * ```ts
 * import { ExtraPromotionsPlugin } from '\@rahul_vendure/vendure-plugin-extra-promotions';
 *
 * const config: VendureConfig = {
 *     plugins: [
 *         ExtraPromotionsPlugin,
 *     ],
 * };
 * ```
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: (config: RuntimeVendureConfig) => {
        // Register all conditions
        config.promotionOptions.promotionConditions?.push(
            firstOrderCondition,
            collectionContainsCondition,
            notInCollectionCondition,
            minOrderCountCondition,
            minStockLevelCondition,
            timeRangeCondition,
            weekdayCondition,
            crossSellCondition,
            happyHoursCollectionCondition,
        );

        // Register all actions
        config.promotionOptions.promotionActions?.push(
            collectionDiscountAction,
            excludeCollectionDiscountAction,
            crossSellDiscountAction,
            stockClearanceDiscountAction,
            happyHoursCollectionDiscountAction,
        );

        return config;
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.0.0',
})
export class ExtraPromotionsPlugin {}
