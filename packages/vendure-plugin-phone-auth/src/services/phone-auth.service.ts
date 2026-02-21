import { Inject, Injectable } from '@nestjs/common';
import { CurrentUser, CurrentUserChannel } from '@vendure/common/lib/generated-types';
import {
    AuthService,
    ConfigService,
    CustomerService,
    ExternalAuthenticationMethod,
    ExternalAuthenticationService,
    InternalServerError,
    Logger,
    NativeAuthenticationMethod,
    patchEntity,
    RequestContext,
    setSessionToken,
    TransactionalConnection,
    User,
    UserInputError,
    UserService,
} from '@vendure/core';
import { getUserChannelsPermissions } from '@vendure/core/dist/service/helpers/utils/get-user-channels-permissions';
import { NotVerifiedError } from '@vendure/core/dist/common/error/generated-graphql-shop-errors';
import { Request, Response } from 'express';
import { isValidPhoneNumber } from 'libphonenumber-js';

import { AUTHENTICATION_STRATEGY_NAME, loggerCtx, PHONE_AUTH_PLUGIN_OPTIONS } from '../constants';
import {
    InvalidOtpError,
    PhoneNotVerifiedError,
    PhoneNumberConflictError,
    PhoneNumberValidationError,
} from '../errors/phone-auth.errors';
import { PhoneAuthPluginOptions } from '../types';
import { PhoneOtpService } from './phone-otp.service';

@Injectable()
export class PhoneAuthService {
    constructor(
        private connection: TransactionalConnection,
        private customerService: CustomerService,
        private configService: ConfigService,
        private authService: AuthService,
        private userService: UserService,
        private externalAuthenticationService: ExternalAuthenticationService,
        private phoneOtpService: PhoneOtpService,
        @Inject(PHONE_AUTH_PLUGIN_OPTIONS)
        private options: PhoneAuthPluginOptions,
    ) {}

    /**
     * Unified: request OTP for any phone number (new or existing user).
     */
    async requestOtp(
        ctx: RequestContext,
        phoneNumber: string,
    ): Promise<{ success: boolean; otpExpiresIn?: number | null } | PhoneNumberValidationError> {
        if (!isValidPhoneNumber(phoneNumber)) {
            return new PhoneNumberValidationError();
        }

        const sent = await this.phoneOtpService.sendOtp(ctx, phoneNumber);
        if (!sent) {
            throw new InternalServerError('Failed to send OTP');
        }

        const remaining = await this.phoneOtpService.getRemainingTimeSeconds(phoneNumber);
        return { success: true, otpExpiresIn: remaining };
    }

    /**
     * Unified: verify OTP and login. Creates account if user doesn't exist.
     */
    async verifyOtpAndLogin(
        ctx: RequestContext,
        input: { phoneNumber: string; code: string },
        req: Request,
        res: Response,
    ): Promise<CurrentUser | PhoneNumberValidationError | InvalidOtpError> {
        if (!isValidPhoneNumber(input.phoneNumber)) {
            return new PhoneNumberValidationError();
        }

        const isOtpValid = await this.phoneOtpService.verifyOtp(input.phoneNumber, input.code);
        if (!isOtpValid) {
            return new InvalidOtpError();
        }

        return this.connection.withTransaction(ctx, async (txCtx) => {
            let user = await this.externalAuthenticationService.findCustomerUser(
                txCtx,
                AUTHENTICATION_STRATEGY_NAME,
                input.phoneNumber,
                false,
            );

            if (!user) {
                // Auto-create account
                const syntheticEmail = this.buildSyntheticEmail(input.phoneNumber);
                user = await this.externalAuthenticationService.createCustomerAndUser(txCtx, {
                    strategy: AUTHENTICATION_STRATEGY_NAME,
                    externalIdentifier: input.phoneNumber,
                    verified: true,
                    emailAddress: syntheticEmail,
                    firstName: '',
                    lastName: '',
                });

                // Ensure native auth method exists (some Vendure internals expect it)
                const hasNative = user.authenticationMethods.some(
                    (m): m is NativeAuthenticationMethod => m instanceof NativeAuthenticationMethod,
                );
                if (!hasNative) {
                    const dummyPassword = `otp-only-${Date.now()}-${Math.random()}`;
                    await this.userService.addNativeAuthenticationMethod(
                        txCtx,
                        user,
                        syntheticEmail,
                        dummyPassword,
                    );
                }

                // Set phone number on customer
                const customer = await this.customerService.findOneByUserId(txCtx, user.id);
                if (customer) {
                    await this.customerService.update(
                        txCtx,
                        patchEntity(customer, { phoneNumber: input.phoneNumber }),
                    );
                }
            }

            // Mark phone as verified
            await this.markPhoneVerified(txCtx, input.phoneNumber);

            // Re-fetch user after potential updates
            user = await this.externalAuthenticationService.findCustomerUser(
                txCtx,
                AUTHENTICATION_STRATEGY_NAME,
                input.phoneNumber,
                false,
            );
            if (!user) {
                return new InvalidOtpError();
            }

            const strategy = this.getPhoneAuthStrategy();
            const session = await this.authService.createAuthenticatedSessionForUser(
                txCtx,
                user,
                strategy.name,
            );
            if (session instanceof NotVerifiedError) {
                return new InvalidOtpError();
            }

            setSessionToken({
                req,
                res,
                authOptions: this.configService.authOptions,
                rememberMe: false,
                sessionToken: session.token,
            });

            return this.toCurrentUser(session.user);
        }) as any;
    }

    /**
     * Request OTP to update authenticated user's phone number.
     */
    async requestUpdatePhoneNumberOtp(
        ctx: RequestContext,
        newPhoneNumber: string,
    ): Promise<
        | { success: boolean; otpExpiresIn?: number | null }
        | PhoneNumberValidationError
        | PhoneNumberConflictError
    > {
        if (!isValidPhoneNumber(newPhoneNumber)) {
            return new PhoneNumberValidationError();
        }

        const currentUser = await this.userService.getUserById(ctx, ctx.activeUserId!);
        if (!currentUser) {
            throw new UserInputError('User not found');
        }

        // Check if phone is already taken by another user
        const existing = await this.externalAuthenticationService.findCustomerUser(
            ctx,
            AUTHENTICATION_STRATEGY_NAME,
            newPhoneNumber,
            false,
        );
        if (existing && existing.id !== currentUser.id) {
            return new PhoneNumberConflictError();
        }

        const sent = await this.phoneOtpService.sendOtp(ctx, newPhoneNumber);
        if (!sent) {
            throw new InternalServerError('Failed to send OTP');
        }

        const remaining = await this.phoneOtpService.getRemainingTimeSeconds(newPhoneNumber);
        return { success: true, otpExpiresIn: remaining };
    }

    /**
     * Verify OTP and update authenticated user's phone number.
     */
    async updatePhoneNumber(
        ctx: RequestContext,
        input: { phoneNumber: string; code: string },
    ): Promise<{ success: boolean } | PhoneNumberValidationError | InvalidOtpError> {
        if (!isValidPhoneNumber(input.phoneNumber)) {
            return new PhoneNumberValidationError();
        }

        const isOtpValid = await this.phoneOtpService.verifyOtp(input.phoneNumber, input.code);
        if (!isOtpValid) {
            return new InvalidOtpError();
        }

        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId!);
        if (!customer) {
            throw new UserInputError('No customer found for the current user');
        }

        // Update customer phone number
        const updatedEmail = this.rebuildSyntheticEmailIfNeeded(customer.emailAddress, input.phoneNumber);
        await this.customerService.update(
            ctx,
            patchEntity(customer, {
                phoneNumber: input.phoneNumber,
                ...(updatedEmail ? { emailAddress: updatedEmail } : {}),
            }),
        );

        // Update external auth identifier
        const authMethod = await this.connection
            .getRepository(ctx, ExternalAuthenticationMethod)
            .findOne({
                where: {
                    user: { id: ctx.activeUserId },
                    strategy: AUTHENTICATION_STRATEGY_NAME,
                },
            });
        if (authMethod) {
            await this.connection
                .getRepository(ctx, ExternalAuthenticationMethod)
                .update(authMethod.id, { externalIdentifier: input.phoneNumber });
        }

        return { success: true };
    }

    // --- Private helpers ---

    private getPhoneAuthStrategy() {
        const match = this.configService.authOptions.shopAuthenticationStrategy.find(
            (s) => s.name === AUTHENTICATION_STRATEGY_NAME,
        );
        if (!match) {
            throw new InternalServerError('error.unrecognized-authentication-strategy', {
                name: AUTHENTICATION_STRATEGY_NAME,
            });
        }
        return match;
    }

    private async markPhoneVerified(ctx: RequestContext, phoneNumber: string): Promise<void> {
        const user = await this.externalAuthenticationService.findCustomerUser(
            ctx,
            AUTHENTICATION_STRATEGY_NAME,
            phoneNumber,
            false,
        );
        if (!user) {
            throw new UserInputError('No user found for the provided phone number');
        }
        await this.connection.getRepository(ctx, User).update(user.id, {
            verified: true,
            customFields: { isPhoneVerified: true },
        });
    }

    private toCurrentUser(user: User): CurrentUser {
        return {
            id: user.id,
            identifier: user.identifier,
            channels: getUserChannelsPermissions(user) as CurrentUserChannel[],
        };
    }

    private buildSyntheticEmail(phoneNumber: string): string {
        return `${phoneNumber}+noreply@phone-auth.vendure`;
    }

    private rebuildSyntheticEmailIfNeeded(
        currentEmail: string | null | undefined,
        newPhoneNumber: string,
    ): string | null {
        if (!currentEmail) return null;
        const match = currentEmail.match(/^(\+?\d+)(\+noreply@.+)$/);
        return match ? `${newPhoneNumber}${match[2]}` : null;
    }
}
