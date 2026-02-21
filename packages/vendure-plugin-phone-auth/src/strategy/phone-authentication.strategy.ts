import {
    AuthenticationStrategy,
    ExternalAuthenticationService,
    Injector,
    RequestContext,
    User,
} from '@vendure/core';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';

import { AUTHENTICATION_STRATEGY_NAME } from '../constants';

export type PhoneAuthData = {
    phoneNumber: string;
};

/**
 * OTP-only authentication strategy.
 * The actual OTP verification is handled by PhoneAuthService.
 * This strategy simply looks up the user by phone number (external identifier).
 */
export class PhoneAuthenticationStrategy implements AuthenticationStrategy<PhoneAuthData> {
    readonly name = AUTHENTICATION_STRATEGY_NAME;
    private externalAuthenticationService: ExternalAuthenticationService;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
    }

    defineInputType(): DocumentNode {
        return gql`
            input PhoneAuthInput {
                phoneNumber: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: PhoneAuthData): Promise<User | false | string> {
        const user = await this.externalAuthenticationService.findCustomerUser(
            ctx,
            this.name,
            data.phoneNumber,
            false,
        );

        if (!user) {
            return false;
        }

        if (!user.customFields.isPhoneVerified) {
            return 'PHONE_NOT_VERIFIED';
        }

        return user;
    }
}
