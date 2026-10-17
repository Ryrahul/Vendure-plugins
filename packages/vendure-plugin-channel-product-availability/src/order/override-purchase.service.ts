import { Injectable } from '@nestjs/common';
import {
    ConfigService,
    EntityNotFoundError,
    ID,
    InsufficientStockError,
    NegativeQuantityError,
    Order,
    OrderInterceptorError,
    OrderLine,
    OrderModificationError,
    OrderModifier,
    OrderService,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In, IsNull } from 'typeorm';

import { ChannelProductAvailabilityService } from '../services/channel-product-availability.service';

export interface AddItemInput {
    productVariantId: ID;
    quantity: number;
    customFields?: { [key: string]: any };
}

/** An error result as returned by core's OrderService methods. */
export type OrderErrorResult = { __typename?: string; errorCode?: any; message?: string; [key: string]: any };

export interface AddItemsResult {
    order: Order;
    errorResults: OrderErrorResult[];
}

/**
 * Adds items to an order, routing products that are **globally disabled but
 * explicitly enabled in the active channel** around core's hard
 * `product.enabled` check in `OrderService.addItemsToOrder`.
 *
 * Everything else is delegated to `OrderService.addItemsToOrder` unchanged.
 * See ARCHITECTURE.md §4 for the exact sequence and its guarantees.
 */
@Injectable()
export class OverridePurchaseService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private orderModifier: OrderModifier,
        private configService: ConfigService,
        private availabilityService: ChannelProductAvailabilityService,
    ) {}

    async addItemsToOrder(
        ctx: RequestContext,
        orderId: ID,
        items: AddItemInput[],
        relations?: any[],
    ): Promise<AddItemsResult> {
        const overrideVariantIds = await this.getOverrideEnabledVariantIds(
            ctx,
            items.map(i => i.productVariantId),
        );
        const coreItems = items.filter(i => !overrideVariantIds.has(String(i.productVariantId)));
        const overrideItems = items.filter(i => overrideVariantIds.has(String(i.productVariantId)));

        if (!overrideItems.length) {
            return this.orderService.addItemsToOrder(ctx, orderId, coreItems, relations);
        }
        const errorResults: OrderErrorResult[] = [];
        if (coreItems.length) {
            const coreResult = await this.orderService.addItemsToOrder(ctx, orderId, coreItems);
            errorResults.push(...coreResult.errorResults);
        }
        for (const item of overrideItems) {
            const error = await this.addOverrideEnabledItem(ctx, orderId, item);
            if (error) {
                errorResults.push(error);
            }
        }
        const order = await this.orderService.findOne(ctx, orderId, relations);
        if (!order) {
            throw new EntityNotFoundError('Order', orderId);
        }
        // Mirror core: InsufficientStockError carries the final order.
        const finalErrors = errorResults.map(e =>
            e instanceof InsufficientStockError || (e as any).__typename === 'InsufficientStockError'
                ? new InsufficientStockError({ order, quantityAvailable: (e as any).quantityAvailable })
                : e,
        );
        return { order, errorResults: finalErrors };
    }

    /**
     * Single-item variant with the same return shape as `OrderService.addItemToOrder`.
     */
    async addItemToOrder(
        ctx: RequestContext,
        orderId: ID,
        item: AddItemInput,
        relations?: any[],
    ): Promise<Order | OrderErrorResult> {
        const result = await this.addItemsToOrder(ctx, orderId, [item], relations);
        return result.errorResults.length ? result.errorResults[0] : result.order;
    }

    /**
     * Variant ids whose product is globally disabled but explicitly enabled in the
     * active channel. Only these need the override path.
     */
    private async getOverrideEnabledVariantIds(ctx: RequestContext, variantIds: ID[]): Promise<Set<string>> {
        if (!variantIds.length) {
            return new Set();
        }
        const variants = await this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('variant')
            .innerJoin('variant.product', 'product')
            .select(['variant.id', 'variant.productId'])
            .where('variant.id IN (:...ids)', { ids: variantIds })
            .andWhere('product.enabled = :enabled', { enabled: false })
            .getMany();
        if (!variants.length) {
            return new Set();
        }
        const overrides = await this.availabilityService.getOverrides(
            ctx,
            variants.map(v => v.productId),
        );
        return new Set(variants.filter(v => overrides.get(String(v.productId)) === true).map(v => String(v.id)));
    }

    private async addOverrideEnabledItem(
        ctx: RequestContext,
        orderId: ID,
        { productVariantId, quantity, customFields }: AddItemInput,
    ): Promise<OrderErrorResult | undefined> {
        if (quantity <= 0) {
            return new NegativeQuantityError();
        }
        const order = await this.orderService.findOne(ctx, orderId);
        if (!order) {
            throw new EntityNotFoundError('Order', orderId);
        }
        if (order.state !== 'AddingItems' && order.state !== 'Draft') {
            return new OrderModificationError();
        }
        // Same variant-level guard core applies (enabled, not deleted), plus channel membership.
        const variant = await this.connection.findOneInChannel(ctx, ProductVariant, productVariantId, ctx.channelId, {
            relations: ['product'],
            where: { enabled: true, deletedAt: IsNull() },
            loadEagerRelations: false,
        });
        if (!variant) {
            throw new EntityNotFoundError('ProductVariant', productVariantId);
        }
        const existingLine = await this.orderModifier.getExistingOrderLine(ctx, order, productVariantId, customFields);
        const quantityInOtherLines = order.lines
            .filter(l => String(l.productVariantId) === String(productVariantId) && l.id !== existingLine?.id)
            .reduce((sum, l) => sum + l.quantity, 0);
        const correctedQuantity = await this.orderModifier.constrainQuantityToSaleable(
            ctx,
            variant,
            quantity,
            existingLine?.quantity,
            quantityInOtherLines,
        );
        if (correctedQuantity === 0) {
            return new InsufficientStockError({ order, quantityAvailable: 0 });
        }
        for (const interceptor of this.configService.orderOptions.orderInterceptors ?? []) {
            if (interceptor.willAddItemToOrder) {
                const error = await interceptor.willAddItemToOrder(ctx, order, {
                    productVariant: variant,
                    quantity: correctedQuantity,
                    customFields,
                });
                if (error) {
                    return new OrderInterceptorError({ interceptorError: error });
                }
            }
        }
        const line = await this.orderModifier.getOrCreateOrderLine(ctx, order, productVariantId, customFields);
        // constrainQuantityToSaleable returns the new line *total* when stock suffices, but
        // only the addable *increment* when it does not — mirror core's handling of both.
        const targetQuantity =
            correctedQuantity < quantity ? (existingLine?.quantity ?? 0) + correctedQuantity : correctedQuantity;
        // adjustOrderLines re-applies order/line limits, willAdjustOrderLine interceptors,
        // stock constraints and price adjustments (promotions, tax, shipping).
        const result = await this.orderService.adjustOrderLines(ctx, orderId, [
            { orderLineId: line.id, quantity: targetQuantity },
        ]);
        if (result.errorResults.length) {
            if (!existingLine) {
                await this.removeEmptyLine(ctx, line.id);
            }
            return result.errorResults[0];
        }
        if (correctedQuantity < quantity) {
            return new InsufficientStockError({ order: result.order, quantityAvailable: correctedQuantity });
        }
        return undefined;
    }

    private async removeEmptyLine(ctx: RequestContext, lineId: ID) {
        const repo = this.connection.getRepository(ctx, OrderLine);
        const line = await repo.findOne({ where: { id: lineId }, loadEagerRelations: false });
        if (line && line.quantity === 0) {
            await repo.delete({ id: In([lineId]) });
        }
    }
}

