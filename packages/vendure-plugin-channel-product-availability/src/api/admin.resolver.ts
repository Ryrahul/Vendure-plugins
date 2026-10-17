import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Product, RequestContext, Transaction, TransactionalConnection } from '@vendure/core';

import {
    MutationClearProductChannelAvailabilityArgs,
    MutationSetProductChannelAvailabilityArgs,
    QueryProductChannelAvailabilitiesArgs,
    QueryProductChannelAvailabilityArgs,
    QueryProductChannelAvailabilityOverridesArgs,
} from '../generated-graphql-types';
import { ChannelAccessService, READ_PERMISSIONS, UPDATE_PERMISSIONS } from '../services/channel-access.service';
import { ChannelProductAvailabilityService } from '../services/channel-product-availability.service';

@Resolver()
export class ChannelProductAvailabilityAdminResolver {
    constructor(
        private availabilityService: ChannelProductAvailabilityService,
        private channelAccess: ChannelAccessService,
        private connection: TransactionalConnection,
    ) {}

    @Query()
    @Allow(...READ_PERMISSIONS)
    async productChannelAvailability(@Ctx() ctx: RequestContext, @Args() args: QueryProductChannelAvailabilityArgs) {
        const channelId = args.channelId ?? ctx.channelId;
        this.channelAccess.assertPermissionInChannel(ctx, channelId, READ_PERMISSIONS);
        return this.availabilityService.getAvailabilityForChannel(ctx, args.productId, channelId);
    }

    @Query()
    @Allow(...READ_PERMISSIONS)
    async productChannelAvailabilities(@Ctx() ctx: RequestContext, @Args() args: QueryProductChannelAvailabilitiesArgs) {
        const product = await this.connection.getEntityOrThrow(ctx, Product, args.productId, {
            relations: ['channels'],
            loadEagerRelations: false,
        });
        const readable = new Set(this.channelAccess.channelIdsWithPermission(ctx, READ_PERMISSIONS));
        const channelIds = product.channels.map(c => c.id).filter(id => readable.has(String(id)));
        return this.availabilityService.getAvailabilityForChannels(ctx, product.id, channelIds);
    }

    @Query()
    @Allow(...READ_PERMISSIONS)
    async productChannelAvailabilityOverrides(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProductChannelAvailabilityOverridesArgs,
    ) {
        const channelId = args.options?.channelId ?? ctx.channelId;
        this.channelAccess.assertPermissionInChannel(ctx, channelId, READ_PERMISSIONS);
        return this.availabilityService.listOverrides(ctx, channelId, {
            productId: args.options?.productId ?? undefined,
            enabled: args.options?.enabled ?? undefined,
            skip: args.options?.skip ?? undefined,
            take: args.options?.take ?? undefined,
        });
    }

    @Transaction()
    @Mutation()
    @Allow(...UPDATE_PERMISSIONS)
    async setProductChannelAvailability(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetProductChannelAvailabilityArgs,
    ) {
        const channelId = args.input.channelId ?? ctx.channelId;
        this.channelAccess.assertPermissionInChannel(ctx, channelId, UPDATE_PERMISSIONS);
        return this.availabilityService.setOverride(ctx, args.input.productId, args.input.enabled, channelId);
    }

    @Transaction()
    @Mutation()
    @Allow(...UPDATE_PERMISSIONS)
    async clearProductChannelAvailability(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationClearProductChannelAvailabilityArgs,
    ) {
        const channelId = args.input.channelId ?? ctx.channelId;
        this.channelAccess.assertPermissionInChannel(ctx, channelId, UPDATE_PERMISSIONS);
        return this.availabilityService.clearOverride(ctx, args.input.productId, channelId);
    }
}
