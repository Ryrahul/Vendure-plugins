import {
    ID,
    Injector,
    Order,
    OrderInterceptor,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
    WillAddItemToOrderInput,
    WillAdjustOrderLineInput,
} from '@vendure/core';

import { ChannelProductAvailabilityService } from '../services/channel-product-availability.service';

export const PRODUCT_DISABLED_IN_CHANNEL_MESSAGE = 'This product is not available in the current channel';

/**
 * Rejects adding, or increasing the quantity of, a product that is **explicitly
 * disabled** in the active channel.
 *
 * Products without an override are left to core, so global behaviour is unchanged
 * (core rejects globally-disabled products before interceptors run). Decreasing
 * quantities and removing lines are always allowed so customers can clean up carts.
 */
export class ChannelAvailabilityOrderInterceptor implements OrderInterceptor {
    private availabilityService: ChannelProductAvailabilityService;
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.availabilityService = injector.get(ChannelProductAvailabilityService);
        this.connection = injector.get(TransactionalConnection);
    }

    async willAddItemToOrder(ctx: RequestContext, order: Order, input: WillAddItemToOrderInput) {
        const productId = input.productVariant.productId ?? input.productVariant.product?.id;
        if (await this.isExplicitlyDisabled(ctx, productId)) {
            return PRODUCT_DISABLED_IN_CHANNEL_MESSAGE;
        }
    }

    async willAdjustOrderLine(ctx: RequestContext, order: Order, input: WillAdjustOrderLineInput) {
        if (input.quantity <= input.orderLine.quantity) {
            return;
        }
        let productId: ID | undefined = input.orderLine.productVariant?.productId;
        if (productId == null) {
            const variant = await this.connection.getRepository(ctx, ProductVariant).findOne({
                where: { id: input.orderLine.productVariantId },
                select: ['id', 'productId'],
                loadEagerRelations: false,
            });
            productId = variant?.productId;
        }
        if (await this.isExplicitlyDisabled(ctx, productId)) {
            return PRODUCT_DISABLED_IN_CHANNEL_MESSAGE;
        }
    }

    private async isExplicitlyDisabled(ctx: RequestContext, productId: any): Promise<boolean> {
        if (productId == null) {
            return false;
        }
        const overrides = await this.availabilityService.getOverrides(ctx, [productId]);
        return overrides.get(String(productId)) === false;
    }
}
