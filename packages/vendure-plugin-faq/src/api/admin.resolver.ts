import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';

import { faqPermission } from '../constants';
import { Faq } from '../entities/faq.entity';
import { FaqService } from '../services/faq.service';
import {
    MutationCreateFaqArgs,
    MutationUpdateFaqArgs,
    MutationDeleteFaqArgs,
    MutationAssignFaqsToChannelsArgs,
    MutationRemoveFaqsFromCurrentChannelArgs,
    QueryFaqArgs,
    QueryFaqsArgs,
} from '../gql/generated';

@Resolver()
export class FaqAdminResolver {
    constructor(private faqService: FaqService) {}

    @Allow(faqPermission.Create)
    @Mutation()
    async createFaq(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateFaqArgs,
    ) {
        return this.faqService.create(ctx, args.input);
    }

    @Allow(faqPermission.Update)
    @Mutation()
    async updateFaq(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateFaqArgs,
    ) {
        return this.faqService.update(ctx, args.input);
    }

    @Allow(faqPermission.Read)
    @Query()
    async faqs(@Ctx() ctx: RequestContext, @Args() args: QueryFaqsArgs) {
        return this.faqService.findAll(ctx, args.options ?? undefined);
    }

    @Allow(faqPermission.Read)
    @Query()
    async faq(@Ctx() ctx: RequestContext, @Args() args: QueryFaqArgs) {
        return this.faqService.findOne(ctx, args.id);
    }

    @Transaction()
    @Allow(faqPermission.Delete)
    @Mutation()
    async deleteFaq(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteFaqArgs,
    ) {
        return this.faqService.delete(ctx, args.ids);
    }

    @Transaction()
    @Mutation()
    @Allow(faqPermission.Update)
    async assignFaqsToChannels(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAssignFaqsToChannelsArgs,
    ): Promise<Faq[]> {
        return this.faqService.assignToChannels(ctx, args.input.faqIds, args.input.channelIds);
    }

    @Transaction()
    @Mutation()
    @Allow(faqPermission.Update)
    async removeFaqsFromCurrentChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveFaqsFromCurrentChannelArgs,
    ): Promise<Faq[]> {
        return this.faqService.removeFromCurrentChannel(ctx, args.faqIds);
    }
}
