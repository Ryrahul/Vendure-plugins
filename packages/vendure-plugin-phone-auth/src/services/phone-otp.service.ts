import { Inject, Injectable } from '@nestjs/common';
import { CacheService, Logger, PasswordCipher, RequestContext } from '@vendure/core';
import { randomInt } from 'crypto';

import { loggerCtx, PHONE_AUTH_PLUGIN_OPTIONS } from '../constants';
import { PhoneAuthPluginOptions } from '../types';

@Injectable()
export class PhoneOtpService {
    constructor(
        private cacheService: CacheService,
        private passwordCipher: PasswordCipher,
        @Inject(PHONE_AUTH_PLUGIN_OPTIONS)
        private options: PhoneAuthPluginOptions,
    ) {}

    async sendOtp(ctx: RequestContext, phoneNumber: string): Promise<boolean> {
        try {
            const ttl = this.options.otpTtlMs ?? 60000;

            if (this.options.devMode) {
                Logger.debug(`[devMode] OTP for ${phoneNumber} is 123456`, loggerCtx);
                const timestampKey = this.getTimestampKey(phoneNumber);
                const existing = await this.cacheService.get<string>(timestampKey);
                if (existing) {
                    Logger.debug(`[devMode] OTP already active for ${phoneNumber}, skipping`, loggerCtx);
                    return true;
                }
                await this.storeTimestamp(phoneNumber, ttl);
                return true;
            }

            const key = this.getOtpKey(phoneNumber);
            const cached = await this.cacheService.get<string>(key);
            if (cached) {
                Logger.debug(`OTP already active for ${phoneNumber}, skipping resend`, loggerCtx);
                return true;
            }

            const otp = this.generateOtp();
            const template = this.options.messageTemplate ?? 'Your verification code is: {code}';
            const message = template.replace('{code}', otp);

            await this.options.smsProvider.sendSms(ctx, phoneNumber, message);
            Logger.debug(`OTP sent to ${phoneNumber}`, loggerCtx);

            const hashedOtp = await this.passwordCipher.hash(otp);
            await this.cacheService.set(key, hashedOtp, { ttl });
            await this.storeTimestamp(phoneNumber, ttl);

            return true;
        } catch (error: any) {
            Logger.error(`Failed to send OTP to ${phoneNumber}: ${error.message}`, loggerCtx);
            return false;
        }
    }

    async verifyOtp(phoneNumber: string, otp: string): Promise<boolean> {
        try {
            const expectedLength = this.options.otpLength ?? 6;
            if (otp.length !== expectedLength) {
                return false;
            }

            if (this.options.devMode) {
                Logger.debug(`[devMode] Verifying OTP for ${phoneNumber}`, loggerCtx);
                const isValid = otp === '123456';
                if (isValid) {
                    await this.deleteTimestamp(phoneNumber);
                }
                return isValid;
            }

            const key = this.getOtpKey(phoneNumber);
            const cachedHash = await this.cacheService.get<string>(key);
            if (!cachedHash) {
                return false;
            }

            const matches = await this.passwordCipher.check(otp, cachedHash);
            if (matches) {
                await this.cacheService.delete(key);
                await this.deleteTimestamp(phoneNumber);
            }
            return matches;
        } catch (error: any) {
            Logger.error(`Failed to verify OTP for ${phoneNumber}: ${error.message}`, loggerCtx);
            return false;
        }
    }

    async getRemainingTimeSeconds(phoneNumber: string): Promise<number | null> {
        try {
            const timestampStr = await this.cacheService.get<string>(this.getTimestampKey(phoneNumber));
            if (!timestampStr) {
                return null;
            }
            const timestamp = parseInt(timestampStr, 10);
            const ttl = this.options.otpTtlMs ?? 60000;
            const remaining = Math.floor((ttl - (Date.now() - timestamp)) / 1000);
            return remaining > 0 ? remaining : 0;
        } catch (error: any) {
            Logger.error(`Failed to get remaining time for ${phoneNumber}: ${error.message}`, loggerCtx);
            return null;
        }
    }

    private generateOtp(): string {
        const length = this.options.otpLength ?? 6;
        const min = Math.pow(10, length - 1);
        const max = Math.pow(10, length);
        return randomInt(min, max).toString();
    }

    private getOtpKey(phoneNumber: string): string {
        return `phone-otp:${phoneNumber}`;
    }

    private getTimestampKey(phoneNumber: string): string {
        return `phone-otp-ts:${phoneNumber}`;
    }

    private async storeTimestamp(phoneNumber: string, ttl: number): Promise<void> {
        await this.cacheService.set(this.getTimestampKey(phoneNumber), Date.now().toString(), { ttl });
    }

    private async deleteTimestamp(phoneNumber: string): Promise<void> {
        await this.cacheService.delete(this.getTimestampKey(phoneNumber));
    }
}
