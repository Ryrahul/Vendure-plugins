import { Args, Query, Resolver } from '@nestjs/graphql';
import { Ctx, RequestContext } from '@vendure/core';

import { FaqService } from '../services/faq.service';

@Resolver()
export class FaqShopResolver {
    constructor(private faqService: FaqService) {}

    @Query()
    async faqs(@Ctx() ctx: RequestContext, @Args() args: { options?: any }) {
        return this.faqService.findAll(ctx, {
            ...args.options,
            filter: { enabled: { eq: true } },
        });
    }
}
