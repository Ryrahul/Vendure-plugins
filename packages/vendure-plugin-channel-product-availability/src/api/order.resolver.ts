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

import { OverridePurchaseService } from '../order/override-purchase.service';

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
        return this.purchaseService.addItemToOrder(
            ctx,
            order.id,
            { productVariantId: args.productVariantId, quantity: args.quantity, customFields: args.customFields },
            relations,
        );
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async addItemsToOrder(@Ctx() ctx: RequestContext, @Args() args: any) {
        const order = await this.activeOrderService.getActiveOrder(ctx, args[ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        const result = await this.purchaseService.addItemsToOrder(ctx, order.id, args.inputs);
        return { order: result.order, errorResults: result.errorResults };
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
        return this.purchaseService.addItemToOrder(ctx, orderId, {
            productVariantId: input.productVariantId,
            quantity: input.quantity,
            customFields: input.customFields,
        });
    }
}
