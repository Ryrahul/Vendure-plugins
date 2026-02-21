import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, RequestContext, Transaction } from '@vendure/core';

import { faqPermission } from '../constants';
import { Faq } from '../entities/faq.entity';
import { FaqService } from '../services/faq.service';
import { CreateFaqInput, UpdateFaqInput } from '../types';

@Resolver()
export class FaqAdminResolver {
    constructor(private faqService: FaqService) {}

    @Allow(faqPermission.Create)
    @Mutation()
    async createFaq(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: CreateFaqInput },
    ) {
        return this.faqService.create(ctx, args.input);
    }

    @Allow(faqPermission.Update)
    @Mutation()
    async updateFaq(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: UpdateFaqInput },
    ) {
        return this.faqService.update(ctx, args.input);
    }

    @Allow(faqPermission.Read)
    @Query()
    async faqs(@Ctx() ctx: RequestContext, @Args() args: any) {
        return this.faqService.findAll(ctx, args.options);
    }

    @Allow(faqPermission.Read)
    @Query()
    async faq(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.faqService.findOne(ctx, args.id);
    }

    @Transaction()
    @Allow(faqPermission.Delete)
    @Mutation()
    async deleteFaq(
        @Ctx() ctx: RequestContext,
        @Args() args: { ids: ID[] },
    ) {
        return this.faqService.delete(ctx, args.ids);
    }

    @Transaction()
    @Mutation()
    @Allow(faqPermission.Update)
    async assignFaqsToChannels(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { faqIds: ID[]; channelIds: ID[] } },
    ): Promise<Faq[]> {
        return this.faqService.assignToChannels(ctx, args.input.faqIds, args.input.channelIds);
    }

    @Transaction()
    @Mutation()
    @Allow(faqPermission.Update)
    async removeFaqsFromCurrentChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: { faqIds: ID[] },
    ): Promise<Faq[]> {
        return this.faqService.removeFromCurrentChannel(ctx, args.faqIds);
    }
}
