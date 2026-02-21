import { ResolveField, Resolver } from '@nestjs/graphql';
import { isGraphQlErrorResult } from '@vendure/core';

@Resolver('RequestOtpResult')
export class RequestOtpResultResolver {
    @ResolveField()
    __resolveType(value: any) {
        return isGraphQlErrorResult(value) ? (value as any).__typename : 'Success';
    }
}

@Resolver('VerifyOtpAndLoginResult')
export class VerifyOtpAndLoginResultResolver {
    @ResolveField()
    __resolveType(value: any) {
        return isGraphQlErrorResult(value) ? (value as any).__typename : 'CurrentUser';
    }
}

@Resolver('RequestUpdatePhoneNumberOtpResult')
export class RequestUpdatePhoneNumberOtpResultResolver {
    @ResolveField()
    __resolveType(value: any) {
        return isGraphQlErrorResult(value) ? (value as any).__typename : 'Success';
    }
}

@Resolver('UpdatePhoneNumberResult')
export class UpdatePhoneNumberResultResolver {
    @ResolveField()
    __resolveType(value: any) {
        return isGraphQlErrorResult(value) ? (value as any).__typename : 'Success';
    }
}
