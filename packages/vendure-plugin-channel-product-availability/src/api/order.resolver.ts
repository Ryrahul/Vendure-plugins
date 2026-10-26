import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
    ACTIVE_ORDER_INPUT_FIELD_NAME,
    ActiveOrderService,
    Allow,
    Ctx,
    Order,
    Permission,
    Relations,
    RelationPaths,
    RequestContext,
    Transaction,
} from '@vendure/core';

import {
    PRODUCT_DISABLED_IN_CHANNEL_ERROR_KEY,
    PRODUCT_DISABLED_IN_CHANNEL_MESSAGE,
} from '../order/channel-availability-order-interceptor';
import { OverridePurchaseService } from '../order/override-purchase.service';

/**
 * Core's OrderInterceptorError has a generic `message` ("An error occurred when attempting to
 * modify the Order"); the reason is only in `interceptorError`. For this plugin's refusal, the
 * reason becomes the message, which is what storefronts usually show.
 *
 * Vendure translates a mutation's top-level error result through i18n
 * (`errorResult.<message>`), so it gets the registered key; error results nested in a list
 * (`addItemsToOrder.errorResults`) are not translated and get the text itself.
 */
function withReadableRefusal<T>(result: T, translated = true): T {
    const error = result as any;
    if (error?.errorCode === 'ORDER_INTERCEPTOR_ERROR' && error.interceptorError === PRODUCT_DISABLED_IN_CHANNEL_MESSAGE) {
        error.message = translated ? PRODUCT_DISABLED_IN_CHANNEL_ERROR_KEY : PRODUCT_DISABLED_IN_CHANNEL_MESSAGE;
    }
    return result;
}

/**
 * Overrides the Shop API add-to-cart mutations. Same decorators and semantics as
 * core; items whose product is globally disabled but explicitly enabled in the
 * channel are routed around core's hard `product.enabled` check.
 */
@Resolver()
export class ShopOrderAvailabilityResolver {
    constructor(
        private activeOrderService: ActiveOrderService,
        private purchaseService: OverridePurchaseService,
    ) {}

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async addItemToOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: any,
        @Relations({ entity: Order, omit: ['aggregateOrder', 'sellerOrders'] }) relations: RelationPaths<Order>,
    ) {
        const order = await this.activeOrderService.getActiveOrder(ctx, args[ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        return withReadableRefusal(
            await this.purchaseService.addItemToOrder(
                ctx,
                order.id,
                { productVariantId: args.productVariantId, quantity: args.quantity, customFields: args.customFields },
                relations,
            ),
        );
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async addItemsToOrder(@Ctx() ctx: RequestContext, @Args() args: any) {
        const order = await this.activeOrderService.getActiveOrder(ctx, args[ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        const result = await this.purchaseService.addItemsToOrder(ctx, order.id, args.inputs);
        return { order: result.order, errorResults: result.errorResults.map(r => withReadableRefusal(r, false)) };
    }
}

/**
 * Overrides the Admin API `addItemToDraftOrder` mutation with the same routing.
 */
@Resolver()
export class AdminDraftOrderAvailabilityResolver {
    constructor(private purchaseService: OverridePurchaseService) {}

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async addItemToDraftOrder(@Ctx() ctx: RequestContext, @Args() args: any) {
        const { orderId, input } = args;
        return withReadableRefusal(
            await this.purchaseService.addItemToOrder(ctx, orderId, {
                productVariantId: input.productVariantId,
                quantity: input.quantity,
                customFields: input.customFields,
            }),
        );
    }
}
