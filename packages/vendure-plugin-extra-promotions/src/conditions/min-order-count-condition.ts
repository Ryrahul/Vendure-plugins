import { LanguageCode, OrderService, PromotionCondition } from '@vendure/core';

let orderService: OrderService;

/**
 * @description
 * Checks if the customer has placed at least `minimum` previous orders.
 * Useful for loyalty-tier promotions, e.g. "10% off after your 5th order".
 */
export const minOrderCountCondition = new PromotionCondition({
    code: 'min_order_count',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Customer has placed at least { minimum } previous orders',
        },
    ],
    args: {
        minimum: {
            type: 'int',
            defaultValue: 1,
            ui: { component: 'number-form-input', min: 1 },
        },
    },
    init(injector) {
        orderService = injector.get(OrderService);
    },
    async check(ctx, order, args) {
        if (!order.customer) {
            return false;
        }
        const existingOrders = await orderService.findByCustomerId(ctx, order.customer.id, {
            take: 0,
            filter: {
                active: { eq: false },
            },
        });
        return existingOrders.totalItems >= args.minimum;
    },
});
