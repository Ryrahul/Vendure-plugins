import { Args, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Api,
    ApiType,
    Collection,
    Ctx,
    Product,
    ProductService,
    ProductVariant,
    ProductVariantService,
    Relations,
    RelationPaths,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { ProductChannelAvailability } from '../entities/product-channel-availability.entity';
import { enforceGuardFilter } from '../services/availability-rules';
import { ChannelProductAvailabilityService } from '../services/channel-product-availability.service';

/**
 * Overrides the Shop API `products` and `product` queries. Identical to core except
 * that the `enabled` guard is replaced by the channel-aware rule, applied in SQL so
 * that counts and pagination stay correct.
 */
@Resolver()
export class ShopCatalogAvailabilityResolver {
    constructor(
        private productService: ProductService,
        private availabilityService: ChannelProductAvailabilityService,
    ) {}

    @Query()
    async products(
        @Ctx() ctx: RequestContext,
        @Args() args: any,
        @Relations({ entity: Product, omit: ['variants', 'assets'] }) relations: RelationPaths<Product>,
    ) {
        const guard = await this.availabilityService.getEffectiveEnabledProductFilter(ctx);
        const options = enforceGuardFilter(args.options, guard);
        return this.productService.findAll(ctx, options, relations);
    }

    @Query()
    async product(
        @Ctx() ctx: RequestContext,
        @Args() args: { id?: string; slug?: string },
        @Relations({ entity: Product, omit: ['variants', 'assets'] }) relations: RelationPaths<Product>,
    ) {
        let result: Product | undefined;
        if (args.id) {
            result = await this.productService.findOne(ctx, args.id, relations);
        } else if (args.slug) {
            result = await this.productService.findOneBySlug(ctx, args.slug, relations);
        } else {
            throw new UserInputError('error.product-id-or-slug-must-be-provided');
        }
        if (!result) {
            return;
        }
        if (!(await this.availabilityService.isEnabled(ctx, result.id, result.enabled))) {
            return;
        }
        result.facetValues = result.facetValues?.filter(fv => !fv.facet.isPrivate);
        return result;
    }
}

/**
 * Overrides `Collection.productVariants` in the Shop API so that variants of
 * products explicitly enabled in the channel are listed, and variants of products
 * explicitly disabled are not. The Admin API delegates to core unchanged.
 */
@Resolver('Collection')
export class ShopCollectionAvailabilityResolver {
    constructor(
        private productVariantService: ProductVariantService,
        private connection: TransactionalConnection,
    ) {}

    @ResolveField()
    async productVariants(
        @Ctx() ctx: RequestContext,
        @Parent() collection: Collection,
        @Args() args: any,
        @Api() apiType: ApiType,
        @Relations({ entity: ProductVariant, omit: ['assets'] }) relations: RelationPaths<ProductVariant>,
    ) {
        if (apiType !== 'shop') {
            return this.productVariantService.getVariantsByCollectionId(ctx, collection.id, args.options, relations);
        }
        const disabledProductIds = await this.getEffectivelyDisabledProductIds(ctx, collection.id);
        // The guard must always be nested in `_and`: a top-level `filter.enabled` triggers
        // core's shortcut that adds `product.enabled = true`, which would hide products
        // explicitly enabled in this channel.
        const guard: Record<string, any> = {
            _and: [
                { enabled: { eq: true } },
                ...(disabledProductIds.length ? [{ productId: { notIn: disabledProductIds } }] : []),
            ],
        };
        const options = enforceGuardFilter(args.options, guard);
        return this.productVariantService.getVariantsByCollectionId(ctx, collection.id, options, relations);
    }

    /**
     * Products with variants in the collection that are effectively disabled in the
     * active channel: globally disabled without an enabling override, or explicitly
     * disabled.
     */
    private async getEffectivelyDisabledProductIds(ctx: RequestContext, collectionId: string | number) {
        const rows = await this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('variant')
            .innerJoin('variant.product', 'product')
            .innerJoin('variant.collections', 'collection', 'collection.id = :collectionId', { collectionId })
            .leftJoin(
                ProductChannelAvailability,
                'pca',
                'pca.productId = product.id AND pca.channelId = :channelId',
                { channelId: ctx.channelId },
            )
            .select('product.id', 'productId')
            .distinct(true)
            .where('variant.deletedAt IS NULL')
            .andWhere(
                '((pca.id IS NULL AND product.enabled = :falsy) OR (pca.id IS NOT NULL AND pca.enabled = :falsy))',
                { falsy: false },
            )
            .getRawMany<{ productId: string | number }>();
        return rows.map(r => String(r.productId));
    }
}
