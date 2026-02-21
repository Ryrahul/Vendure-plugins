import { Injectable } from '@nestjs/common';
import { DeletionResponse, DeletionResult } from '@vendure/common/lib/generated-types';
import {
    ID,
    ListQueryBuilder,
    ListQueryOptions,
    PaginatedList,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    assertFound,
} from '@vendure/core';
import { In } from 'typeorm';

import { WishlistItem } from '../entities/wishlist-item.entity';

@Injectable()
export class WishlistService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private productVariantService: ProductVariantService,
    ) {}

    async findOne(ctx: RequestContext, id: ID): Promise<WishlistItem> {
        return this.connection.getRepository(ctx, WishlistItem).findOneOrFail({
            where: { id },
            relations: ['productVariant', 'productVariant.featuredAsset'],
        });
    }

    async findAllByCustomerId(
        ctx: RequestContext,
        customerId: ID,
        options?: ListQueryOptions<WishlistItem>,
    ): Promise<PaginatedList<WishlistItem>> {
        return this.listQueryBuilder
            .build(WishlistItem, options, {
                ctx,
                where: { customerId },
                relations: ['productVariant', 'productVariant.featuredAsset'],
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items,
                totalItems,
            }));
    }

    async create(ctx: RequestContext, customerId: ID, productVariantId: ID): Promise<WishlistItem> {
        const productVariant = await this.productVariantService.findOne(ctx, productVariantId);
        if (!productVariant) {
            throw new UserInputError('Product variant not found');
        }

        const existing = await this.connection.getRepository(ctx, WishlistItem).findOne({
            where: { customerId, productVariantId },
            relations: ['productVariant', 'productVariant.featuredAsset'],
        });
        if (existing) {
            return existing;
        }

        const wishlistItem = new WishlistItem({ customerId, productVariant });
        const saved = await this.connection.getRepository(ctx, WishlistItem).save(wishlistItem);
        return assertFound(this.findOne(ctx, saved.id));
    }

    async createMultiple(
        ctx: RequestContext,
        customerId: ID,
        productVariantIds: ID[],
    ): Promise<WishlistItem[]> {
        if (!productVariantIds.length) {
            return [];
        }

        const repo = this.connection.getRepository(ctx, WishlistItem);

        // Fetch existing items and product variants in parallel
        const [existingItems, productVariants] = await Promise.all([
            repo.find({
                where: { customerId, productVariantId: In(productVariantIds) },
                relations: ['productVariant', 'productVariant.featuredAsset'],
            }),
            Promise.all(productVariantIds.map((id) => this.productVariantService.findOne(ctx, id))),
        ]);

        // Validate all variants exist
        const missingIdx = productVariants.findIndex((pv) => !pv);
        if (missingIdx !== -1) {
            throw new UserInputError(`Product variant not found: ${productVariantIds[missingIdx]}`);
        }

        // Filter out already-existing ones
        const existingVariantIds = new Set(existingItems.map((item) => String(item.productVariantId)));
        const newItems = productVariants
            .filter((pv) => !existingVariantIds.has(String(pv!.id)))
            .map((pv) => new WishlistItem({ customerId, productVariant: pv! }));

        if (newItems.length === 0) {
            return existingItems;
        }

        // Bulk save and re-fetch with relations
        const savedItems = await repo.save(newItems);
        const newlyCreated = await repo.find({
            where: { id: In(savedItems.map((i) => i.id)) },
            relations: ['productVariant', 'productVariant.featuredAsset'],
        });

        return [...existingItems, ...newlyCreated];
    }

    async delete(
        ctx: RequestContext,
        customerId: ID,
        id?: ID | null,
        productVariantId?: ID | null,
    ): Promise<DeletionResponse> {
        if (!id && !productVariantId) {
            throw new UserInputError('Either id or productVariantId must be provided.');
        }

        const where: Record<string, any> = { customerId };
        if (id) where.id = id;
        if (productVariantId) where.productVariantId = productVariantId;

        const entity = await this.connection.getRepository(ctx, WishlistItem).findOne({ where });
        if (!entity) {
            return { result: DeletionResult.NOT_DELETED, message: 'Wishlist item not found' };
        }

        try {
            await this.connection.getRepository(ctx, WishlistItem).remove(entity);
            return { result: DeletionResult.DELETED };
        } catch (e: any) {
            return { result: DeletionResult.NOT_DELETED, message: e.toString() };
        }
    }

    async deleteMultiple(
        ctx: RequestContext,
        customerId: ID,
        productVariantIds: ID[],
    ): Promise<DeletionResponse> {
        if (!productVariantIds.length) {
            throw new UserInputError('productVariantIds must be provided.');
        }

        try {
            const result = await this.connection
                .getRepository(ctx, WishlistItem)
                .delete({ customerId, productVariantId: In(productVariantIds) });

            return {
                result: (result.affected || 0) > 0 ? DeletionResult.DELETED : DeletionResult.NOT_DELETED,
            };
        } catch (e: any) {
            return { result: DeletionResult.NOT_DELETED, message: e.toString() };
        }
    }

    async isInWishlist(ctx: RequestContext, customerId: ID, productVariantId: ID): Promise<boolean> {
        const count = await this.connection.getRepository(ctx, WishlistItem).count({
            where: { customerId, productVariantId },
        });
        return count > 0;
    }
}
