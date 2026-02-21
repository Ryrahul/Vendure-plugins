import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    Permission,
    RequestContext,
    Transaction,
} from '@vendure/core';
import { Request, Response } from 'express';

import { PhoneAuthService } from '../services/phone-auth.service';

@Resolver()
export class PhoneAuthResolver {
    constructor(private phoneAuthService: PhoneAuthService) {}

    @Mutation()
    @Allow(Permission.Public)
    async requestOtp(
        @Ctx() ctx: RequestContext,
        @Args('phoneNumber') phoneNumber: string,
    ) {
        return this.phoneAuthService.requestOtp(ctx, phoneNumber);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    async verifyOtpAndLogin(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { phoneNumber: string; code: string } },
        @Context('req') req: Request,
        @Context('res') res: Response,
    ) {
        return this.phoneAuthService.verifyOtpAndLogin(ctx, args.input, req, res);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async requestUpdatePhoneNumberOtp(
        @Ctx() ctx: RequestContext,
        @Args('newPhoneNumber') newPhoneNumber: string,
    ) {
        return this.phoneAuthService.requestUpdatePhoneNumberOtp(ctx, newPhoneNumber);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async updatePhoneNumber(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { phoneNumber: string; code: string } },
    ) {
        return this.phoneAuthService.updatePhoneNumber(ctx, args.input);
    }
}
