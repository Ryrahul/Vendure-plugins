import { LanguageCode, OrderService, PromotionCondition } from '@vendure/core';

let orderService: OrderService;

/**
 * @description
 * Checks if the customer placing the order is a first-time customer,
 * i.e. they have no previously-placed orders (excluding the current active order).
 */
export const firstOrderCondition = new PromotionCondition({
    code: 'first_order',
    description: [
        { languageCode: LanguageCode.en, value: 'Customer is placing their first order' },
    ],
    args: {},
    init(injector) {
        orderService = injector.get(OrderService);
    },
    async check(ctx, order) {
        if (!order.customer) {
            return false;
        }
        const existingOrders = await orderService.findByCustomerId(ctx, order.customer.id, {
            take: 1,
            filter: {
                // Only count orders that have been placed (not draft/active)
                active: { eq: false },
            },
        });
        return existingOrders.totalItems === 0;
    },
});
