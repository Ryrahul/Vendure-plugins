import { OnApplicationBootstrap } from '@nestjs/common';
import { I18nService, LanguageCode, PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { shopApiExtensions } from './api/api-extensions';
import { PhoneAuthResolver } from './api/phone-auth.resolver';
import {
    RequestOtpResultResolver,
    RequestUpdatePhoneNumberOtpResultResolver,
    UpdatePhoneNumberResultResolver,
    VerifyOtpAndLoginResultResolver,
} from './api/union-type.resolvers';
import { PHONE_AUTH_PLUGIN_OPTIONS } from './constants';
import { PhoneAuthService } from './services/phone-auth.service';
import { PhoneOtpService } from './services/phone-otp.service';
import { PhoneAuthenticationStrategy } from './strategy/phone-authentication.strategy';
import { PhoneAuthPluginOptions } from './types';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomUserFields {
        isPhoneVerified: boolean;
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        {
            provide: PHONE_AUTH_PLUGIN_OPTIONS,
            useFactory: () => PhoneAuthPlugin.options,
        },
        PhoneAuthService,
        PhoneOtpService,
    ],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [
            PhoneAuthResolver,
            RequestOtpResultResolver,
            VerifyOtpAndLoginResultResolver,
            RequestUpdatePhoneNumberOtpResultResolver,
            UpdatePhoneNumberResultResolver,
        ],
    },
    configuration: (config) => {
        config.customFields.User.push({
            name: 'isPhoneVerified',
            type: 'boolean',
            defaultValue: false,
            label: [{ languageCode: LanguageCode.en, value: 'Is Phone Verified' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Indicates if the phone number has been verified via OTP',
                },
            ],
        });
        config.authOptions.shopAuthenticationStrategy.push(new PhoneAuthenticationStrategy());
        return config;
    },
    compatibility: '^3.0.0',
})
export class PhoneAuthPlugin implements OnApplicationBootstrap {
    static options: PhoneAuthPluginOptions;

    static init(options: PhoneAuthPluginOptions): Type<PhoneAuthPlugin> {
        this.options = {
            otpTtlMs: 60000,
            otpLength: 6,
            messageTemplate: 'Your verification code is: {code}',
            devMode: false,
            ...options,
        };
        return PhoneAuthPlugin;
    }

    constructor(private i18nService: I18nService) {}

    onApplicationBootstrap() {
        this.i18nService.addTranslation(LanguageCode.en, {
            errorResult: {
                INVALID_OTP_ERROR: 'Invalid OTP code',
                PHONE_NUMBER_VALIDATION_ERROR: 'Invalid phone number format',
                PHONE_NUMBER_CONFLICT_ERROR: 'This phone number is already registered to another account',
                PHONE_NOT_VERIFIED_ERROR: 'Phone number is not verified',
            },
        });
    }
}
