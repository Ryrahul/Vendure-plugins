import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Ctx,
    Customer,
    CustomerService,
    ForbiddenError,
    InternalServerError,
    ProductVariant,
    RequestContext,
} from '@vendure/core';

import { WishlistService } from '../services/wishlist.service';

@Resolver('ProductVariant')
export class ProductVariantEntityResolver {
    constructor(
        private customerService: CustomerService,
        private wishlistService: WishlistService,
    ) {}

    @ResolveField()
    async isInWishlist(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<boolean> {
        const userId = ctx.activeUserId;
        if (!userId) {
            return false;
        }
        const customer = await this.customerService.findOneByUserId(ctx, userId);
        if (!customer) {
            return false;
        }
        return this.wishlistService.isInWishlist(ctx, customer.id, productVariant.id);
    }
}
