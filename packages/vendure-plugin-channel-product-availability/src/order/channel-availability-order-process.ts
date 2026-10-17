import { ID, Injector, OrderProcess, ProductVariant, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';

import { ChannelProductAvailabilityService } from '../services/channel-product-availability.service';

/**
 * Prevents checkout of an order that still contains a line whose product became
 * **explicitly disabled** in the order's channel after it was added to the cart.
 *
 * Blocks the transition into `ArrangingPayment` with a message naming the affected
 * lines; the customer can remove them (removal is never blocked) and retry.
 * Products without an override keep core behaviour.
 */
export function createChannelAvailabilityOrderProcess(): OrderProcess<any> {
    let availabilityService: ChannelProductAvailabilityService;
    let connection: TransactionalConnection;
    return {
        init(injector: Injector) {
            availabilityService = injector.get(ChannelProductAvailabilityService);
            connection = injector.get(TransactionalConnection);
        },
        async onTransitionStart(fromState, toState, { ctx, order }) {
            if (toState !== 'ArrangingPayment' || !order.lines?.length) {
                return;
            }
            const variantIds = order.lines.map(l => l.productVariantId);
            const variants = await connection.getRepository(ctx, ProductVariant).find({
                where: { id: In(variantIds) },
                select: ['id', 'productId'],
                loadEagerRelations: false,
            });
            const productIdByVariant = new Map<string, ID>(variants.map(v => [String(v.id), v.productId]));
            const overrides = await availabilityService.getOverrides(ctx, unique(variants.map(v => v.productId)));
            const blockedLines = order.lines.filter(line => {
                const productId = productIdByVariant.get(String(line.productVariantId));
                return productId != null && overrides.get(String(productId)) === false;
            });
            if (blockedLines.length) {
                const ids = blockedLines.map(l => String(l.id)).join(', ');
                return `The order contains products that are not available in this channel (order line ids: ${ids}). Remove them to continue.`;
            }
        },
    };
}

function unique<T>(items: T[]): T[] {
    return Array.from(new Set(items));
}
